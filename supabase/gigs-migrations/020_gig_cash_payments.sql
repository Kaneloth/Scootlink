-- ============================================================
-- Skootlink — Gigs: cash payments and driver commission debt
-- Branch: feature/ride-hailing
-- Depends on: 011 (matching), 013 (offers), 018, 019
--
-- Decisions (2026-10-17/18): debt-offset model; drivers opt in to cash.
--   * The customer chooses card or cash on the payment screen. A cash gig
--     starts searching at once and is offered only to drivers who accept
--     cash and are within the debt limit.
--   * The customer pays the driver the fare in cash. On completion the
--     driver's earnings get a NEGATIVE entry for the commission they owe
--     ('cash_commission'). Card earnings are netted against it automatically:
--     a payout is always the net balance.
--   * A driver who owes more than app_settings.gig_cash_debt_limit
--     (default R200) gets no cash gigs until the balance is back under it —
--     by doing card gigs, or by paying the debt through PayFast
--     ('settlement').
--   * Cash gigs have no cancellation / no-show fee: there is no way to
--     collect it (assumption, stated; revisit with a card-on-file later).
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 0. Helper for this migration: drop a CHECK constraint by the column it
--    checks (names given by "add column ... check" aren't guaranteed).
create or replace function pg_temp.drop_checks_on(p_table regclass, p_column text)
returns void language plpgsql as $f$
declare v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
    where con.conrelid = p_table and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~ ('\m' || p_column || '\M')
  loop
    execute format('alter table %s drop constraint %I', p_table, v_name);
  end loop;
end;
$f$;

-- 1. Settings and the driver's opt-in ------------------------------------------
alter table public.app_settings
  add column if not exists gig_cash_debt_limit numeric not null default 200;
alter table public.driver_gig_verification
  add column if not exists accepts_cash boolean not null default false;

-- 2. gig_requests: a cash gig's payment status ---------------------------------
-- 'cash' = the customer pays the driver directly
select pg_temp.drop_checks_on('public.gig_requests', 'payment_status');
alter table public.gig_requests
  add constraint gig_requests_payment_status_check
  check (payment_status in ('none', 'awaiting', 'paid', 'refund_due', 'refunded', 'kept', 'cash'));

-- 3. Earnings ledger: debt and settlement entries ------------------------------
alter table public.gig_earnings_ledger alter column gig_request_id drop not null;
select pg_temp.drop_checks_on('public.gig_earnings_ledger', 'entry_type');
alter table public.gig_earnings_ledger
  add constraint gig_earnings_ledger_entry_type_check
  check (entry_type in ('gig_earning', 'cancellation_fee', 'cash_commission', 'settlement'));
alter table public.gig_earnings_ledger
  add column if not exists platform_payment_id bigint unique references public.platform_payments(id);
alter table public.gig_earnings_ledger drop constraint if exists gig_earnings_ledger_link_check;
alter table public.gig_earnings_ledger
  add constraint gig_earnings_ledger_link_check
  check (case when entry_type = 'settlement'
              then gig_request_id is null and platform_payment_id is not null
              else gig_request_id is not null end);

-- 4. Who may take a cash gig ------------------------------------------------------
-- Balance = everything available and not yet paid out (negative = owes).
create or replace function public._driver_cash_balance(p_driver uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from public.gig_earnings_ledger
  where driver_id = p_driver and status = 'available' and withdrawal_id is null;
$$;

create or replace function public._driver_can_take_cash(p_driver uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select accepts_cash from public.driver_gig_verification where driver_id = p_driver), false)
     and public._driver_cash_balance(p_driver)
         >= -(select coalesce(gig_cash_debt_limit, 200) from public.app_settings where id = 1);
$$;
revoke execute on function public._driver_cash_balance(uuid) from public, anon, authenticated;
revoke execute on function public._driver_can_take_cash(uuid) from public, anon, authenticated;

-- 5. Matching: cash gigs only go to drivers who can take them (replaces 011) -----
create or replace function public.find_nearby_eligible_drivers(
  p_gig_id bigint,
  p_radius_meters integer default 5000
)
returns table (driver_id uuid, distance_meters double precision)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gig public.gig_requests;
begin
  select * into v_gig from public.gig_requests where id = p_gig_id;

  if not found then
    raise exception 'Gig request % not found', p_gig_id;
  end if;

  return query
  select
    dll.driver_id,
    st_distance(dll.location, v_gig.pickup_geo_location) as distance_meters
  from public.driver_live_locations dll
  join public.driver_gig_verification dgv on dgv.driver_id = dll.driver_id
  join public.profiles p on p.id = dll.driver_id
  where dll.is_available = true
    and dll.updated_at > now() - interval '2 minutes'
    and dgv.status = 'approved'
    and dll.driver_id <> v_gig.customer_id
    and p.banned is not true
    and p.blacklisted is not true
    and (p.suspended_until is null or p.suspended_until <= now())
    and not exists (
      select 1 from public.gig_requests busy
      where busy.driver_id = dll.driver_id
        and (busy.status = 'accepted'
             or (busy.status = 'in_progress' and busy.driver_completed_at is null))
    )
    and st_dwithin(dll.location, v_gig.pickup_geo_location, p_radius_meters)
    and (
      (v_gig.gig_type = 'delivery' and dgv.tier in ('delivery_ready', 'passenger_ready'))
      or (v_gig.gig_type = 'ride' and dgv.tier = 'passenger_ready')
    )
    and (v_gig.payment_method <> 'cash' or public._driver_can_take_cash(dll.driver_id))
  order by 2 asc;
end;
$$;
revoke execute on function public.find_nearby_eligible_drivers(bigint, integer) from public, anon, authenticated;
grant execute on function public.find_nearby_eligible_drivers(bigint, integer) to service_role;

-- 5b. How many drivers could take this gig, by card and by cash -----------------
-- (gig-checkout, service role only — shown on the payment screen as counts)
create or replace function public.gig_driver_counts(p_gig_id bigint, p_radius_meters integer)
returns table (card_drivers integer, cash_drivers integer)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer,
         (count(*) filter (where public._driver_can_take_cash(f.driver_id)))::integer
  from public.find_nearby_eligible_drivers(p_gig_id, p_radius_meters) f;
$$;
revoke execute on function public.gig_driver_counts(bigint, integer) from public, anon, authenticated;
grant execute on function public.gig_driver_counts(bigint, integer) to service_role;

-- 6. Accept: the same cash rule, enforced on the row itself ---------------------
-- A trigger rather than another copy of accept_gig_request (011): whatever
-- assigns a driver to a cash gig, an ineligible one is refused.
create or replace function public._gig_cash_accept_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_method = 'cash' and new.driver_id is not null
     and not public._driver_can_take_cash(new.driver_id) then
    raise exception 'This is a cash gig. Turn on cash gigs and keep what you owe under the limit to accept it';
  end if;
  return new;
end;
$$;
revoke execute on function public._gig_cash_accept_guard() from public, anon, authenticated;

drop trigger if exists trg_gig_cash_accept_guard on public.gig_requests;
create trigger trg_gig_cash_accept_guard
  before update of status on public.gig_requests
  for each row
  when (old.status = 'pending' and new.status = 'accepted')
  execute function public._gig_cash_accept_guard();

-- 7. Offer details show the payment method (replaces 013) -----------------------
drop function if exists public.get_gig_offer(bigint);
create function public.get_gig_offer(p_gig_id bigint)
returns table (
  gig_id bigint,
  gig_type text,
  status text,
  pickup_address text,
  dropoff_address text,
  fare_amount numeric,
  distance_meters double precision,
  offered_at timestamp with time zone,
  payment_method text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.gig_type, g.status, g.pickup_address, g.dropoff_address,
         g.fare_amount, o.distance_meters, o.offered_at, g.payment_method
  from public.gig_offers o
  join public.gig_requests g on g.id = o.gig_id
  where o.gig_id = p_gig_id
    and o.driver_id = auth.uid();
$$;
revoke execute on function public.get_gig_offer(bigint) from public, anon;
grant execute on function public.get_gig_offer(bigint) to authenticated;

-- 8. Customer chose cash (gig-checkout, service role only) -----------------------
create or replace function public.start_cash_gig(p_gig_id bigint, p_customer uuid)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
begin
  update public.gig_requests
  set payment_method = 'cash', payment_status = 'cash', status = 'pending',
      searching_since = now(), updated_at = now()
  where id = p_gig_id and customer_id = p_customer and status = 'awaiting_payment'
  returning * into v_gig;
  if not found then
    raise exception 'This request is no longer waiting for payment';
  end if;
  -- An unpaid card attempt for this gig can no longer be used
  update public.platform_payments set status = 'cancelled'
  where gig_id = p_gig_id and status = 'initiated';
  return v_gig;
end;
$$;

-- 9. Cash gigs carry no cancellation fee (wraps 012's rule) ----------------------
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
  if v_gig.payment_method = 'cash' then
    return; -- nothing was collected and there is no way to collect it
  end if;
  if v_gig.payment_status = 'paid' and v_gig.fare_amount is not null then
    p_fee := least(p_fee, v_gig.fare_amount);
  end if;
  select coalesce(gig_commission_percent, 15) into v_percent from public.app_settings where id = 1;
  v_percent := coalesce(v_percent, 15);
  v_commission := round(p_fee * v_percent / 100, 2);

  update public.gig_requests
  set cancellation_fee = p_fee,
      commission_amount = v_commission,
      driver_payout_amount = p_fee - v_commission
  where id = p_gig_id;

  if v_gig.driver_id is not null then
    insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status, available_at, entry_type)
    values (v_gig.driver_id, p_gig_id, p_fee - v_commission,
            case when v_gig.payment_status = 'paid' then 'available' else 'pending' end,
            case when v_gig.payment_status = 'paid' then now() end,
            'cancellation_fee')
    on conflict (gig_request_id, entry_type) do nothing;
  end if;
end;
$$;
revoke execute on function public._gig_record_cancellation_fee(bigint, numeric) from public, anon, authenticated;

-- The fee QUOTE shown to the customer before cancelling must agree
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
  if v_gig.payment_method = 'cash' then
    return 0;
  end if;
  return public._gig_customer_cancel_fee(v_gig);
end;
$$;

-- 10. Completion entries by payment method ---------------------------------------
-- card, paid:   + driver's share, available
-- cash:         - commission (the driver holds the whole fare), available
-- unpaid/legacy: + driver's share, pending (never withdrawable)
create or replace function public._gig_earning_entry(v_gig public.gig_requests)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if v_gig.payment_method = 'cash' then
    insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status, available_at, entry_type)
    values (v_gig.driver_id, v_gig.id, -coalesce(v_gig.commission_amount, 0), 'available', now(), 'cash_commission')
    on conflict (gig_request_id, entry_type) do nothing;
  else
    insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status, available_at, entry_type)
    values (v_gig.driver_id, v_gig.id, v_gig.driver_payout_amount,
            case when v_gig.payment_status = 'paid' then 'available' else 'pending' end,
            case when v_gig.payment_status = 'paid' then now() end,
            'gig_earning')
    on conflict (gig_request_id, entry_type) do nothing;
  end if;
end;
$$;
revoke execute on function public._gig_earning_entry(public.gig_requests) from public, anon, authenticated;

create or replace function public._gig_finalize(p_gig_id bigint, p_auto boolean)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
  v_percent numeric;
  v_commission numeric;
  v_payout numeric;
begin
  select coalesce(gig_commission_percent, 15) into v_percent from public.app_settings where id = 1;
  v_percent := coalesce(v_percent, 15);

  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found or v_gig.status <> 'in_progress' or v_gig.driver_completed_at is null then
    raise exception 'This gig is not waiting for confirmation';
  end if;

  v_commission := round(coalesce(v_gig.fare_amount, 0) * v_percent / 100, 2);
  v_payout := coalesce(v_gig.fare_amount, 0) - v_commission;

  update public.gig_requests
  set status = 'completed',
      completed_at = now(),
      customer_confirmed_at = case when p_auto then null else now() end,
      auto_confirmed = p_auto,
      commission_amount = v_commission,
      driver_payout_amount = v_payout,
      updated_at = now()
  where id = p_gig_id
  returning * into v_gig;

  perform public._gig_earning_entry(v_gig);
  return v_gig;
end;
$$;
revoke execute on function public._gig_finalize(bigint, boolean) from public, anon, authenticated;

-- Admin "release" of a disputed gig uses the same entry (replaces 018's copy)
create or replace function public.admin_resolve_gig_dispute(
  p_gig_id bigint,
  p_outcome text,
  p_admin_id uuid,
  p_note text default null
)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
  v_percent numeric;
  v_commission numeric;
  v_payout numeric;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
begin
  if p_outcome not in ('release', 'void') then
    raise exception 'Outcome must be release or void';
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found then
    raise exception 'Gig not found';
  end if;
  if v_gig.status <> 'disputed' then
    raise exception 'Only disputed gigs can be resolved';
  end if;

  if p_outcome = 'release' then
    select coalesce(gig_commission_percent, 15) into v_percent from public.app_settings where id = 1;
    v_percent := coalesce(v_percent, 15);
    v_commission := round(coalesce(v_gig.fare_amount, 0) * v_percent / 100, 2);
    v_payout := coalesce(v_gig.fare_amount, 0) - v_commission;

    update public.gig_requests
    set status = 'completed',
        completed_at = now(),
        commission_amount = v_commission,
        driver_payout_amount = v_payout,
        admin_resolution = 'released',
        admin_note = v_note,
        updated_at = now()
    where id = p_gig_id
    returning * into v_gig;

    perform public._gig_earning_entry(v_gig);

    update public.user_reports
    set status = 'dismissed', admin_notes = coalesce(v_note, admin_notes),
        reviewed_by = p_admin_id, reviewed_at = now()
    where gig_id = p_gig_id and coalesce(status, 'pending') = 'pending';
  else
    -- Void: cancelled with no earnings or debt; a paid card fare is refunded by the 018 trigger
    update public.gig_requests
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = p_admin_id,
        cancellation_reason = 'Voided by Skootlink after a dispute',
        commission_amount = 0,
        driver_payout_amount = 0,
        admin_resolution = 'voided',
        admin_note = v_note,
        updated_at = now()
    where id = p_gig_id
    returning * into v_gig;

    update public.user_reports
    set status = 'resolved', admin_notes = coalesce(v_note, admin_notes),
        reviewed_by = p_admin_id, reviewed_at = now()
    where gig_id = p_gig_id and coalesce(status, 'pending') = 'pending';
  end if;

  return v_gig;
end;
$$;

-- 11. Driver: switch cash gigs on/off, and see where they stand ------------------
create or replace function public.set_accepts_cash(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.driver_gig_verification
  set accepts_cash = coalesce(p_on, false), updated_at = now()
  where driver_id = auth.uid() and status = 'approved';
  if not found then
    raise exception 'Only Gig-Ready approved drivers can take cash gigs';
  end if;
  return coalesce(p_on, false);
end;
$$;

create or replace function public.my_cash_status()
returns table (accepts_cash boolean, balance numeric, debt_limit numeric, can_take_cash boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select v.accepts_cash from public.driver_gig_verification v where v.driver_id = auth.uid()), false),
    public._driver_cash_balance(auth.uid()),
    (select coalesce(gig_cash_debt_limit, 200) from public.app_settings where id = 1),
    public._driver_can_take_cash(auth.uid());
$$;

-- 12. Paying off debt through PayFast (ITN, service role only) -------------------
-- Same answers as mark_gig_fare_paid: credited | duplicate | amount_mismatch | unknown.
-- A mismatched amount is still credited as what was actually paid: the money
-- is real and only reduces what the driver owes.
create or replace function public.mark_driver_settlement_paid(
  p_m_payment_id text,
  p_pf_payment_id text,
  p_amount numeric
)
returns table (driver_id uuid, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.platform_payments;
  v_paid numeric := round(coalesce(p_amount, 0), 2);
begin
  select * into v_pay from public.platform_payments
  where m_payment_id = p_m_payment_id and kind = 'driver_settlement'
  for update;
  if not found then
    return query select null::uuid, 'unknown'::text;
    return;
  end if;
  if v_pay.status = 'paid' then
    return query select v_pay.user_id, 'duplicate'::text;
    return;
  end if;
  if v_paid <= 0 then
    return query select v_pay.user_id, 'amount_mismatch'::text;
    return;
  end if;

  update public.platform_payments
  set status = 'paid', pf_payment_id = p_pf_payment_id, paid_at = now()
  where id = v_pay.id;

  insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status, available_at, entry_type, platform_payment_id)
  values (v_pay.user_id, null, v_paid, 'available', now(), 'settlement', v_pay.id);

  return query select v_pay.user_id,
    (case when abs(v_paid - v_pay.amount) > 0.01 then 'amount_mismatch' else 'credited' end)::text;
end;
$$;

-- 13. Payout requests must leave nothing owed (the net must be positive) ---------
-- request_gig_payout (018) totals every available entry, debts included, and
-- checks it against the minimum, so a driver in debt can't request a payout.
-- Nothing to change there; restated here so the rule is written down.

-- 14. Permissions -----------------------------------------------------------------
revoke execute on function public.start_cash_gig(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.mark_driver_settlement_paid(text, text, numeric) from public, anon, authenticated;
revoke execute on function public.set_accepts_cash(boolean) from public, anon;
revoke execute on function public.my_cash_status() from public, anon;
grant execute on function public.start_cash_gig(bigint, uuid) to service_role;
grant execute on function public.mark_driver_settlement_paid(text, text, numeric) to service_role;
grant execute on function public.set_accepts_cash(boolean) to authenticated;
grant execute on function public.my_cash_status() to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
