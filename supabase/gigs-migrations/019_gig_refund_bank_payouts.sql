-- ============================================================
-- Skootlink — Gigs: refunds that PayFast pays to a bank account
-- Branch: feature/ride-hailing
-- Depends on: 018
--
-- Found in the first live refund (2026-10-18): PayFast decides per payment
-- how a refund is paid. Its query endpoint (GET /refunds/:pf_payment_id)
-- returns a method for a full and for a partial refund:
--   PAYMENT_SOURCE  back to the card / original method — no extra details
--   BANK_PAYOUT     paid into the customer's bank account — needs holder,
--                   bank (from PayFast's own list), branch code, account
--                   number (max 12 digits) and type (current / savings)
--   NOT_AVAILABLE   cannot be refunded through the API
-- A partial refund (fare minus a cancellation fee) of a debit-card payment
-- is typically BANK_PAYOUT.
--
-- So a refund can now wait for the customer's bank details:
--   status 'needs_bank_details' + the banks PayFast offers (bank_options).
--   The customer saves refund_bank_accounts on the gig screen; a trigger
--   puts their waiting refunds back to 'due' to be sent.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 1. gig_refunds: new status + what PayFast said --------------------------------
alter table public.gig_refunds drop constraint if exists gig_refunds_status_check;
alter table public.gig_refunds
  add constraint gig_refunds_status_check
  check (status in ('due', 'needs_bank_details', 'processing', 'refunded', 'failed'));
alter table public.gig_refunds add column if not exists refund_method text;      -- PAYMENT_SOURCE | BANK_PAYOUT | NOT_AVAILABLE
alter table public.gig_refunds add column if not exists funding_type text;       -- e.g. 'Debit Card', 'Instant EFT'
alter table public.gig_refunds add column if not exists bank_options jsonb;      -- [{bank_name, label}] from PayFast

-- 2. The customer's bank account for refunds ---------------------------------------
-- Separate from driver_payout_accounts: PayFast needs its own bank codes
-- (e.g. 'FNB', 'STANDARD') and only 'current' / 'savings'.
create table public.refund_bank_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  account_holder text not null check (length(trim(account_holder)) between 2 and 120),
  bank_name text not null check (length(trim(bank_name)) between 2 and 60),   -- PayFast bank code
  bank_label text,                                                             -- what the customer picked
  branch_code text not null check (branch_code ~ '^[0-9]{6}$'),
  account_number text not null check (account_number ~ '^[0-9]{6,12}$'),
  account_type text not null default 'current' check (account_type in ('current', 'savings')),
  updated_at timestamp with time zone not null default now()
);
alter table public.refund_bank_accounts enable row level security;
create policy "user reads own refund account" on public.refund_bank_accounts
  for select using (auth.uid() = user_id);
create policy "user adds own refund account" on public.refund_bank_accounts
  for insert with check (auth.uid() = user_id);
create policy "user updates own refund account" on public.refund_bank_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Saving details releases the customer's waiting refunds
create or replace function public._refund_bank_details_saved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gig_refunds
  set status = 'due', last_error = null
  where customer_id = new.user_id and status = 'needs_bank_details';
  return null;
end;
$$;
revoke execute on function public._refund_bank_details_saved() from public, anon, authenticated;

drop trigger if exists trg_refund_bank_details_saved on public.refund_bank_accounts;
create trigger trg_refund_bank_details_saved
  after insert or update on public.refund_bank_accounts
  for each row execute function public._refund_bank_details_saved();

-- 3. Refund bookkeeping (replaces 018): adds 'needs_bank_details' -----------------
drop function if exists public.admin_record_refund(bigint, text, uuid, text, text);
create or replace function public.admin_record_refund(
  p_refund_id bigint,
  p_outcome text,               -- 'processing' | 'refunded' | 'failed' | 'needs_bank_details'
  p_admin_id uuid,
  p_reference text default null,
  p_error text default null,
  p_method text default null,
  p_funding_type text default null,
  p_bank_options jsonb default null
)
returns public.gig_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.gig_refunds;
begin
  if p_outcome not in ('processing', 'refunded', 'failed', 'needs_bank_details') then
    raise exception 'Outcome must be processing, refunded, failed or needs_bank_details';
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
      last_error = case when p_outcome in ('failed', 'needs_bank_details') then left(coalesce(p_error, 'Unknown error'), 1000)
                        when p_outcome = 'refunded' then null
                        else last_error end,
      provider_reference = coalesce(p_reference, provider_reference),
      processed_by = coalesce(p_admin_id, processed_by),
      processed_at = case when p_outcome = 'refunded' then now() else processed_at end,
      refund_method = coalesce(p_method, refund_method),
      funding_type = coalesce(p_funding_type, funding_type),
      bank_options = coalesce(p_bank_options, bank_options)
  where id = p_refund_id
  returning * into v_ref;

  if p_outcome = 'refunded' then
    update public.gig_requests set payment_status = 'refunded', updated_at = now() where id = v_ref.gig_id;
  end if;
  return v_ref;
end;
$$;
revoke execute on function public.admin_record_refund(bigint, text, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_record_refund(bigint, text, uuid, text, text, text, text, jsonb) to service_role;

commit;

NOTIFY pgrst, 'reload schema';
