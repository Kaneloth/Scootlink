-- ============================================================
-- Skootlink — Gigs: card payments upfront, refunds, driver payouts
-- Branch: feature/ride-hailing
-- Depends on: 001 (gig_earnings_ledger, withdrawal_requests), 010, 012, 015
--
-- Decisions (2026-10-17):
--   * Card gigs are paid UPFRONT through PayFast, before any driver is
--     searched for. The quoted fare is the price.
--   * The fare lands in Skootlink's PayFast account. The driver's share
--     (fare - commission) is credited to their earnings and becomes
--     available to withdraw when the gig completes. Payouts are bank EFTs
--     that an admin approves and marks paid.
--   * If a paid gig is cancelled or no driver is found, the customer is
--     refunded the fare minus any cancellation / no-show fee. PayFast refunds
--     can't be tested in sandbox, so refunds are queued here and sent from
--     admin ("Refund now") until auto refunds are switched on in settings.
--   * Cash gigs and driver debt come in the next migration; payment_method
--     already exists so nothing here needs changing then.
--
-- Flow:
--   create-gig-request  -> gig 'awaiting_payment' + platform_payments row
--   PayFast ITN         -> mark_gig_fare_paid(): gig 'pending', matching starts
--   unpaid for 30 min   -> gig-expiry-check cancels it ("Payment not completed")
--   cancelled / no drivers after payment -> gig_refunds row (trigger, at commit)
--   completion          -> earnings row 'available' (paid) or 'pending' (unpaid
--                          legacy test gigs)
--   driver              -> request_gig_payout(): one open request at a time
--   admin               -> admin_settle_payout(): paid / rejected
--
-- New tables are created WITHOUT "if not exists" on purpose: if a table of
-- the same name already exists, this stops instead of silently using it.
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 1. Settings ------------------------------------------------------------------
alter table public.app_settings
  add column if not exists gig_auto_refunds boolean not null default false;
alter table public.app_settings
  add column if not exists gig_min_payout numeric not null default 100;
alter table public.app_settings
  add column if not exists gig_payment_window_minutes integer not null default 30;

-- 2. gig_requests: payment columns + 'awaiting_payment' status -------------------
alter table public.gig_requests
  add column if not exists payment_method text not null default 'card'
    check (payment_method in ('card', 'cash'));
-- none:       no payment taken (gigs created before payments existed)
-- awaiting:   card gig waiting for the customer to pay
-- paid:       fare received
-- refund_due: cancelled after payment; a refund is queued
-- refunded:   refund sent
-- kept:       cancelled after payment, but the fee covers the whole fare
alter table public.gig_requests
  add column if not exists payment_status text not null default 'none'
    check (payment_status in ('none', 'awaiting', 'paid', 'refund_due', 'refunded', 'kept'));
-- When the driver search started (payment time for card gigs). The expiry
-- job measures "unmatched for N minutes" from here, not from created_at.
alter table public.gig_requests
  add column if not exists searching_since timestamp with time zone;

alter table public.gig_requests drop constraint if exists gig_requests_status_check;
alter table public.gig_requests
  add constraint gig_requests_status_check
  check (status in ('awaiting_payment', 'pending', 'accepted', 'in_progress', 'completed',
                    'disputed', 'cancelled', 'no_drivers_available'));

-- 3. platform_payments: every payment into Skootlink ------------------------------
create table public.platform_payments (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('gig_fare', 'listing_fee', 'driver_settlement')),
  gig_id bigint references public.gig_requests(id),
  vehicle_id bigint,
  amount numeric not null check (amount > 0),
  provider text not null default 'payfast' check (provider in ('payfast', 'google_play')),
  m_payment_id text not null unique,          -- our reference, sent to PayFast
  pf_payment_id text unique,                  -- PayFast's reference, from the ITN
  status text not null default 'initiated' check (status in ('initiated', 'paid', 'cancelled')),
  paid_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);
create index idx_platform_payments_gig on public.platform_payments (gig_id);
create index idx_platform_payments_user on public.platform_payments (user_id);
alter table public.platform_payments enable row level security;
create policy "users read own payments" on public.platform_payments
  for select using (auth.uid() = user_id);

-- 4. gig_refunds: queued refunds of gig fares -------------------------------------
create table public.gig_refunds (
  id bigint generated always as identity primary key,
  payment_id bigint not null unique references public.platform_payments(id),
  gig_id bigint not null references public.gig_requests(id),
  customer_id uuid not null references public.profiles(id),
  amount numeric not null check (amount > 0),
  status text not null default 'due' check (status in ('due', 'processing', 'refunded', 'failed')),
  attempts integer not null default 0,
  last_error text,
  provider_reference text,
  processed_by uuid references public.profiles(id),
  created_at timestamp with time zone not null default now(),
  processed_at timestamp with time zone
);
create index idx_gig_refunds_status on public.gig_refunds (status);
alter table public.gig_refunds enable row level security;
create policy "customers read own refunds" on public.gig_refunds
  for select using (auth.uid() = customer_id);

-- 5. Earnings ledger: entry types, link to a payout ------------------------------
alter table public.gig_earnings_ledger
  add column if not exists entry_type text not null default 'gig_earning'
    check (entry_type in ('gig_earning', 'cancellation_fee'));
alter table public.gig_earnings_ledger
  add column if not exists withdrawal_id bigint references public.withdrawal_requests(id);
-- Was unique (gig_request_id); a gig can have one row per entry type. The old
-- constraint is found by what it covers rather than by name.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.gig_earnings_ledger'::regclass
      and con.contype = 'u'
      and con.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.gig_earnings_ledger'::regclass
                                and attname = 'gig_request_id')]::int2[]
  loop
    execute format('alter table public.gig_earnings_ledger drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.gig_earnings_ledger
  add constraint gig_earnings_ledger_gig_entry_key unique (gig_request_id, entry_type);
-- Existing fee rows (written by 012 before entry_type existed)
update public.gig_earnings_ledger l
set entry_type = 'cancellation_fee'
from public.gig_requests g
where g.id = l.gig_request_id and g.status = 'cancelled' and l.entry_type = 'gig_earning';

-- 6. Payout requests: only through request_gig_payout() ---------------------------
-- 001 let drivers insert withdrawal_requests rows directly with any amount.
drop policy if exists "driver can create own withdrawal requests" on public.withdrawal_requests;
alter table public.withdrawal_requests add column if not exists bank_account_type text;
alter table public.withdrawal_requests add column if not exists payment_reference text;

create table public.driver_payout_accounts (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  account_holder text not null check (length(trim(account_holder)) between 2 and 120),
  bank_name text not null check (length(trim(bank_name)) between 2 and 80),
  account_number text not null check (account_number ~ '^[0-9]{6,16}$'),
  branch_code text not null check (branch_code ~ '^[0-9]{6}$'),
  account_type text not null default 'cheque' check (account_type in ('cheque', 'savings', 'transmission')),
  updated_at timestamp with time zone not null default now()
);
alter table public.driver_payout_accounts enable row level security;
create policy "driver reads own payout account" on public.driver_payout_accounts
  for select using (auth.uid() = driver_id);
create policy "driver adds own payout account" on public.driver_payout_accounts
  for insert with check (auth.uid() = driver_id);
create policy "driver updates own payout account" on public.driver_payout_accounts
  for update using (auth.uid() = driver_id) with check (auth.uid() = driver_id);

-- 7. Payment received (PayFast ITN, service role only) ----------------------------
-- Returns what the webhook should do next:
--   start_matching  the gig was waiting for this payment; search for drivers
--   refund_queued   the gig had already ended (cancelled / expired); full refund queued
--   duplicate       this ITN was already processed
--   amount_mismatch paid amount differs from what we asked for: the gig is
--                   cancelled and whatever was paid is queued for refund
--   unknown         no such payment
create or replace function public.mark_gig_fare_paid(
  p_m_payment_id text,
  p_pf_payment_id text,
  p_amount numeric
)
returns table (gig_id bigint, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.platform_payments;
  v_gig public.gig_requests;
begin
  select * into v_pay from public.platform_payments
  where m_payment_id = p_m_payment_id and kind = 'gig_fare'
  for update;
  if not found then
    return query select null::bigint, 'unknown'::text;
    return;
  end if;
  if v_pay.status = 'paid' then
    return query select v_pay.gig_id, 'duplicate'::text;
    return;
  end if;
  if abs(coalesce(p_amount, 0) - v_pay.amount) > 0.01 then
    -- Money arrived, but not the amount we asked for (tampered form or a
    -- PayFast fault). Don't start the gig; refund whatever was paid.
    update public.platform_payments
    set status = 'paid', pf_payment_id = p_pf_payment_id, paid_at = now()
    where id = v_pay.id;
    update public.gig_requests
    set status = case when status = 'awaiting_payment' then 'cancelled' else status end,
        cancelled_at = case when status = 'awaiting_payment' then now() else cancelled_at end,
        cancellation_reason = case when status = 'awaiting_payment' then 'Payment amount did not match the fare' else cancellation_reason end,
        payment_status = case when coalesce(p_amount, 0) > 0 then 'refund_due' else payment_status end,
        updated_at = now()
    where id = v_pay.gig_id;
    if coalesce(p_amount, 0) > 0 then
      insert into public.gig_refunds (payment_id, gig_id, customer_id, amount)
      select v_pay.id, v_pay.gig_id, v_pay.user_id, round(p_amount, 2)
      on conflict (payment_id) do nothing;
    end if;
    return query select v_pay.gig_id, 'amount_mismatch'::text;
    return;
  end if;

  update public.platform_payments
  set status = 'paid', pf_payment_id = p_pf_payment_id, paid_at = now()
  where id = v_pay.id;

  select * into v_gig from public.gig_requests where id = v_pay.gig_id for update;

  if v_gig.status = 'awaiting_payment' then
    update public.gig_requests
    set status = 'pending', payment_status = 'paid', searching_since = now(), updated_at = now()
    where id = v_gig.id;
    return query select v_gig.id, 'start_matching'::text;
    return;
  end if;

  -- Paid after the request had already ended (customer cancelled, or the
  -- payment window expired): give the money back in full.
  update public.gig_requests set payment_status = 'refund_due', updated_at = now() where id = v_gig.id;
  insert into public.gig_refunds (payment_id, gig_id, customer_id, amount)
  values (v_pay.id, v_gig.id, v_gig.customer_id, v_pay.amount)
  on conflict (payment_id) do nothing;
  return query select v_gig.id, 'refund_queued'::text;
end;
$$;

-- 7b. Unpaid requests expire (gig-expiry-check, service role only) ---------------
-- A card gig nobody paid for within app_settings.gig_payment_window_minutes is
-- cancelled so it stops blocking the customer. If PayFast's ITN still arrives
-- later, mark_gig_fare_paid queues a full refund.
create or replace function public.expire_unpaid_gigs()
returns table (gig_id bigint, customer_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window integer;
begin
  select coalesce(gig_payment_window_minutes, 30) into v_window from public.app_settings where id = 1;
  v_window := coalesce(v_window, 30);

  return query
  with expired as (
    update public.gig_requests g
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'Payment not completed',
        updated_at = now()
    where g.status = 'awaiting_payment'
      and g.created_at < now() - make_interval(mins => v_window)
    returning g.id, g.customer_id
  ), pays as (
    update public.platform_payments p
    set status = 'cancelled'
    from expired e
    where p.gig_id = e.id and p.status = 'initiated'
  )
  select e.id, e.customer_id from expired e;
end;
$$;

-- 8. Refund on cancellation (runs at commit, after any fee has been recorded) -----
-- cancel_gig_request sets the status first and records the fee afterwards in
-- the same transaction, so this is a DEFERRED trigger that re-reads the row.
create or replace function public._gig_queue_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
  v_pay public.platform_payments;
  v_amount numeric;
begin
  select * into v_gig from public.gig_requests where id = new.id for update;
  if v_gig.payment_status <> 'paid' or v_gig.status not in ('cancelled', 'no_drivers_available') then
    return null;
  end if;

  select * into v_pay from public.platform_payments
  where platform_payments.gig_id = v_gig.id and kind = 'gig_fare' and status = 'paid'
  order by id desc limit 1;
  if not found then
    return null;
  end if;

  v_amount := round(greatest(v_pay.amount - coalesce(v_gig.cancellation_fee, 0), 0), 2);

  if v_amount > 0 then
    insert into public.gig_refunds (payment_id, gig_id, customer_id, amount)
    values (v_pay.id, v_gig.id, v_gig.customer_id, v_amount)
    on conflict (payment_id) do nothing;
    update public.gig_requests set payment_status = 'refund_due' where id = v_gig.id;
  else
    update public.gig_requests set payment_status = 'kept' where id = v_gig.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_gig_queue_refund on public.gig_requests;
create constraint trigger trg_gig_queue_refund
  after update of status on public.gig_requests
  deferrable initially deferred
  for each row
  when (old.status is distinct from new.status and new.status in ('cancelled', 'no_drivers_available'))
  execute function public._gig_queue_refund();

-- 9. Refund bookkeeping (admin-payments function, service role only) --------------
create or replace function public.admin_record_refund(
  p_refund_id bigint,
  p_outcome text,               -- 'processing' | 'refunded' | 'failed'
  p_admin_id uuid,
  p_reference text default null,
  p_error text default null
)
returns public.gig_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.gig_refunds;
begin
  if p_outcome not in ('processing', 'refunded', 'failed') then
    raise exception 'Outcome must be processing, refunded or failed';
  end if;
  select * into v_ref from public.gig_refunds where id = p_refund_id for update;
  if not found then
    raise exception 'Refund not found';
  end if;
  if v_ref.status = 'refunded' then
    raise exception 'This refund has already been sent';
  end if;
  if p_outcome = 'processing' and v_ref.status = 'processing' then
    raise exception 'This refund is already being processed';
  end if;

  update public.gig_refunds
  set status = p_outcome,
      attempts = attempts + case when p_outcome = 'processing' then 1 else 0 end,
      last_error = case when p_outcome = 'failed' then left(coalesce(p_error, 'Unknown error'), 1000) else last_error end,
      provider_reference = coalesce(p_reference, provider_reference),
      processed_by = coalesce(p_admin_id, processed_by),
      processed_at = case when p_outcome = 'refunded' then now() else processed_at end
  where id = p_refund_id
  returning * into v_ref;

  if p_outcome = 'refunded' then
    update public.gig_requests set payment_status = 'refunded', updated_at = now() where id = v_ref.gig_id;
  end if;
  return v_ref;
end;
$$;

-- 10. Completion: driver's share is available once the fare was paid -------------
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

  insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status, available_at, entry_type)
  values (v_gig.driver_id, v_gig.id, v_payout,
          case when v_gig.payment_status = 'paid' then 'available' else 'pending' end,
          case when v_gig.payment_status = 'paid' then now() end,
          'gig_earning')
  on conflict (gig_request_id, entry_type) do nothing;

  return v_gig;
end;
$$;
revoke execute on function public._gig_finalize(bigint, boolean) from public, anon, authenticated;

-- 11. Cancellation / no-show fee: driver's share available if the fare was paid --
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
  -- Never charge more than was paid
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

-- 12. Customer may also cancel while still at the payment step (replaces 012) -----
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
    if v_gig.status not in ('awaiting_payment', 'pending', 'accepted') then
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

-- 13. Dispute released by admin: same availability rule (replaces 015) -----------
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

    insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status, available_at, entry_type)
    values (v_gig.driver_id, v_gig.id, v_payout,
            case when v_gig.payment_status = 'paid' then 'available' else 'pending' end,
            case when v_gig.payment_status = 'paid' then now() end,
            'gig_earning')
    on conflict (gig_request_id, entry_type) do nothing;

    update public.user_reports
    set status = 'dismissed', admin_notes = coalesce(v_note, admin_notes),
        reviewed_by = p_admin_id, reviewed_at = now()
    where gig_id = p_gig_id and coalesce(status, 'pending') = 'pending';
  else
    -- Void: cancelled with no earnings; the refund trigger refunds the full fare.
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

-- admin_cancel_gig (015) also covers a gig still waiting for payment
create or replace function public.admin_cancel_gig(
  p_gig_id bigint,
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
begin
  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found then
    raise exception 'Gig not found';
  end if;
  if v_gig.status not in ('awaiting_payment', 'pending', 'accepted', 'in_progress') then
    raise exception 'Only pending, accepted or in-progress gigs (or gigs awaiting payment) can be cancelled';
  end if;

  update public.gig_requests
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_admin_id,
      cancellation_reason = 'Cancelled by Skootlink support',
      admin_resolution = 'admin_cancelled',
      admin_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
      updated_at = now()
  where id = p_gig_id
  returning * into v_gig;

  return v_gig;
end;
$$;

-- 14. Driver: balance and payout request -----------------------------------------
create or replace function public.my_gig_balance()
returns table (available numeric, pending numeric, in_payout numeric, min_payout numeric, open_request_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount) filter (where status = 'available' and withdrawal_id is null), 0),
    coalesce(sum(amount) filter (where status = 'pending'), 0),
    coalesce(sum(amount) filter (where status = 'available' and withdrawal_id is not null), 0),
    (select coalesce(gig_min_payout, 100) from public.app_settings where id = 1),
    (select w.id from public.withdrawal_requests w
      where w.driver_id = auth.uid() and w.status in ('pending', 'processing')
      order by w.id desc limit 1)
  from public.gig_earnings_ledger
  where driver_id = auth.uid();
$$;

create or replace function public.request_gig_payout()
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_acct public.driver_payout_accounts;
  v_amount numeric;
  v_min numeric;
  v_req public.withdrawal_requests;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- One request at a time; lock the driver's ledger rows while we total them
  perform 1 from public.gig_earnings_ledger where driver_id = v_uid for update;
  if exists (select 1 from public.withdrawal_requests
             where driver_id = v_uid and status in ('pending', 'processing')) then
    raise exception 'You already have a payout request in progress';
  end if;

  select * into v_acct from public.driver_payout_accounts where driver_id = v_uid;
  if not found then
    raise exception 'Add your bank details first';
  end if;

  select coalesce(sum(amount), 0) into v_amount
  from public.gig_earnings_ledger
  where driver_id = v_uid and status = 'available' and withdrawal_id is null;

  select coalesce(gig_min_payout, 100) into v_min from public.app_settings where id = 1;
  if v_amount < coalesce(v_min, 100) then
    raise exception 'The minimum payout is R%', to_char(coalesce(v_min, 100), 'FM999990.00');
  end if;

  insert into public.withdrawal_requests (driver_id, amount, status, bank_account_holder, bank_name,
                                          bank_account_number, bank_branch_code, bank_account_type)
  values (v_uid, v_amount, 'pending', v_acct.account_holder, v_acct.bank_name,
          v_acct.account_number, v_acct.branch_code, v_acct.account_type)
  returning * into v_req;

  update public.gig_earnings_ledger
  set withdrawal_id = v_req.id
  where driver_id = v_uid and status = 'available' and withdrawal_id is null;

  return v_req;
end;
$$;

-- 15. Admin: settle a payout (admin-payments function, service role only) --------
create or replace function public.admin_settle_payout(
  p_withdrawal_id bigint,
  p_outcome text,                -- 'processing' | 'paid' | 'rejected'
  p_admin_id uuid,
  p_note text default null       -- EFT reference when paid; reason when rejected
)
returns public.withdrawal_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.withdrawal_requests;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if p_outcome not in ('processing', 'paid', 'rejected') then
    raise exception 'Outcome must be processing, paid or rejected';
  end if;
  select * into v_req from public.withdrawal_requests where id = p_withdrawal_id for update;
  if not found then
    raise exception 'Payout request not found';
  end if;
  if v_req.status not in ('pending', 'processing') then
    raise exception 'This payout request is already closed';
  end if;
  if p_outcome = 'rejected' and v_note is null then
    raise exception 'Give a reason for rejecting the payout';
  end if;

  update public.withdrawal_requests
  set status = p_outcome,
      processed_at = case when p_outcome in ('paid', 'rejected') then now() else processed_at end,
      processed_by = p_admin_id,
      payment_reference = case when p_outcome = 'paid' then v_note else payment_reference end,
      rejection_reason = case when p_outcome = 'rejected' then v_note else rejection_reason end
  where id = p_withdrawal_id
  returning * into v_req;

  if p_outcome = 'paid' then
    update public.gig_earnings_ledger
    set status = 'withdrawn', withdrawn_at = now()
    where withdrawal_id = p_withdrawal_id;
  elsif p_outcome = 'rejected' then
    update public.gig_earnings_ledger
    set withdrawal_id = null
    where withdrawal_id = p_withdrawal_id;
  end if;

  return v_req;
end;
$$;

-- 16. Permissions ------------------------------------------------------------------
revoke execute on function public.mark_gig_fare_paid(text, text, numeric) from public, anon, authenticated;
revoke execute on function public._gig_queue_refund() from public, anon, authenticated;
revoke execute on function public.expire_unpaid_gigs() from public, anon, authenticated;
revoke execute on function public.admin_record_refund(bigint, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_resolve_gig_dispute(bigint, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_cancel_gig(bigint, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_settle_payout(bigint, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.my_gig_balance() from public, anon;
revoke execute on function public.request_gig_payout() from public, anon;
grant execute on function public.mark_gig_fare_paid(text, text, numeric) to service_role;
grant execute on function public.admin_record_refund(bigint, text, uuid, text, text) to service_role;
grant execute on function public.expire_unpaid_gigs() to service_role;
grant execute on function public.admin_resolve_gig_dispute(bigint, text, uuid, text) to service_role;
grant execute on function public.admin_cancel_gig(bigint, uuid, text) to service_role;
grant execute on function public.admin_settle_payout(bigint, text, uuid, text) to service_role;
grant execute on function public.my_gig_balance() to authenticated;
grant execute on function public.request_gig_payout() to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
