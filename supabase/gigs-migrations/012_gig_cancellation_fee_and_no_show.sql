-- ============================================================
-- Skootlink — Gigs feature: cancellation fee and customer no-show
-- Branch: feature/ride-hailing
-- Depends on: 009, 010
--
-- Rules (agreed 2026-10-17; amounts are admin-editable on Gig Settings —
-- starting values R20 / 2 min / 5 min are placeholders, not researched):
--   * Customer cancels while still searching (pending): always free.
--   * Customer cancels after a driver accepted: free during the grace
--     period (gig_cancel_grace_minutes after accepted_at), unless the
--     driver has already arrived. Otherwise the cancellation fee applies.
--   * Driver arrived and waited gig_no_show_wait_minutes: the driver may
--     cancel as a customer no-show; the cancellation fee applies.
--   * Driver cancels: never a fee for the customer.
--   * A fee is recorded on the gig (cancellation_fee) and the driver earns
--     it minus the normal commission, as a 'pending' earnings-ledger entry.
--     Charging the customer's card hooks into this record when payments are
--     built.
--
-- Replaces cancel_gig_request from 009 (same parameters and return type).
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 1. Settings and columns ------------------------------------------------------
alter table public.app_settings
  add column if not exists gig_cancellation_fee numeric not null default 20
    check (gig_cancellation_fee >= 0);
alter table public.app_settings
  add column if not exists gig_cancel_grace_minutes integer not null default 2
    check (gig_cancel_grace_minutes >= 0);
alter table public.app_settings
  add column if not exists gig_no_show_wait_minutes integer not null default 5
    check (gig_no_show_wait_minutes >= 1);

alter table public.gig_requests add column if not exists cancellation_fee numeric;
alter table public.gig_requests add column if not exists customer_no_show boolean not null default false;

-- 2. Internal: the fee that applies if the CUSTOMER cancels this gig now --------
create or replace function public._gig_customer_cancel_fee(v_gig public.gig_requests)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fee numeric;
  v_grace integer;
begin
  if v_gig.status <> 'accepted' then
    return 0; -- pending (still searching) is free; other states can't be cancelled
  end if;

  select coalesce(gig_cancellation_fee, 20), coalesce(gig_cancel_grace_minutes, 2)
    into v_fee, v_grace
  from public.app_settings where id = 1;
  v_fee := coalesce(v_fee, 20);
  v_grace := coalesce(v_grace, 2);

  if v_gig.driver_arrived_at is not null then
    return v_fee;
  end if;
  if v_gig.accepted_at is not null and now() > v_gig.accepted_at + make_interval(mins => v_grace) then
    return v_fee;
  end if;
  return 0;
end;
$$;

revoke execute on function public._gig_customer_cancel_fee(public.gig_requests) from public, anon, authenticated;

-- 3. Internal: record a fee and the driver's share of it --------------------------
create or replace function public._gig_record_cancellation_fee(p_gig_id bigint, p_fee numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
  v_percent numeric;
  v_commission numeric;
begin
  if coalesce(p_fee, 0) <= 0 then
    return;
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id;
  select coalesce(gig_commission_percent, 15) into v_percent from public.app_settings where id = 1;
  v_percent := coalesce(v_percent, 15);
  v_commission := round(p_fee * v_percent / 100, 2);

  update public.gig_requests
  set cancellation_fee = p_fee,
      commission_amount = v_commission,
      driver_payout_amount = p_fee - v_commission
  where id = p_gig_id;

  if v_gig.driver_id is not null then
    insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status)
    values (v_gig.driver_id, p_gig_id, p_fee - v_commission, 'pending')
    on conflict (gig_request_id) do nothing;
  end if;
end;
$$;

revoke execute on function public._gig_record_cancellation_fee(bigint, numeric) from public, anon, authenticated;

-- 4. What would it cost the customer to cancel right now? (shown before confirm)
create or replace function public.gig_cancellation_quote(p_gig_id bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
begin
  select * into v_gig from public.gig_requests where id = p_gig_id;
  if not found or v_gig.customer_id is distinct from auth.uid() then
    raise exception 'Gig not found';
  end if;
  return public._gig_customer_cancel_fee(v_gig);
end;
$$;

-- 5. Cancel (replaces 009): customer pays a fee when the rules above say so --
create or replace function public.cancel_gig_request(
  p_gig_id bigint,
  p_reason text default null
)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gig public.gig_requests;
  v_fee numeric := 0;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id for update;

  if not found then
    raise exception 'Gig not found';
  end if;

  if v_gig.customer_id = v_uid then
    if v_gig.status not in ('pending', 'accepted') then
      raise exception 'This gig can no longer be cancelled';
    end if;
    v_fee := public._gig_customer_cancel_fee(v_gig);
  elsif v_gig.driver_id = v_uid then
    if v_gig.status <> 'accepted' then
      raise exception 'This gig can no longer be cancelled';
    end if;
  else
    raise exception 'Gig not found';
  end if;

  update public.gig_requests
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_uid,
      cancellation_reason = nullif(left(trim(coalesce(p_reason, '')), 500), ''),
      updated_at = now()
  where id = p_gig_id;

  perform public._gig_record_cancellation_fee(p_gig_id, v_fee);

  select * into v_gig from public.gig_requests where id = p_gig_id;
  return v_gig;
end;
$$;

-- 6. Driver: customer didn't show up -------------------------------------------
create or replace function public.gig_customer_no_show(p_gig_id bigint)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gig public.gig_requests;
  v_wait integer;
  v_fee numeric;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found or v_gig.driver_id is distinct from v_uid then
    raise exception 'Gig not found';
  end if;
  if v_gig.status <> 'accepted' or v_gig.driver_arrived_at is null then
    raise exception 'You can only report a no-show after arriving at pickup';
  end if;

  select coalesce(gig_no_show_wait_minutes, 5), coalesce(gig_cancellation_fee, 20)
    into v_wait, v_fee
  from public.app_settings where id = 1;
  v_wait := coalesce(v_wait, 5);
  v_fee := coalesce(v_fee, 20);

  if now() < v_gig.driver_arrived_at + make_interval(mins => v_wait) then
    raise exception 'Please wait % minutes at pickup before reporting a no-show', v_wait;
  end if;

  update public.gig_requests
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_uid,
      customer_no_show = true,
      cancellation_reason = 'Customer did not show up',
      updated_at = now()
  where id = p_gig_id;

  perform public._gig_record_cancellation_fee(p_gig_id, v_fee);

  select * into v_gig from public.gig_requests where id = p_gig_id;
  return v_gig;
end;
$$;

-- 7. How long must this driver wait before a no-show? (for the countdown)
create or replace function public.gig_no_show_wait_minutes()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select gig_no_show_wait_minutes from public.app_settings where id = 1), 5);
$$;

revoke execute on function public.gig_cancellation_quote(bigint) from public, anon;
revoke execute on function public.cancel_gig_request(bigint, text) from public, anon;
revoke execute on function public.gig_customer_no_show(bigint) from public, anon;
revoke execute on function public.gig_no_show_wait_minutes() from public, anon;
grant execute on function public.gig_cancellation_quote(bigint) to authenticated;
grant execute on function public.cancel_gig_request(bigint, text) to authenticated;
grant execute on function public.gig_customer_no_show(bigint) to authenticated;
grant execute on function public.gig_no_show_wait_minutes() to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
