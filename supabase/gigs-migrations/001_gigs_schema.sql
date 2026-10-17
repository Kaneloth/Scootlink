-- ============================================================
-- Skootlink — Gigs feature: initial additive schema migration
-- Branch: feature/ride-hailing
-- Safe to run against production Supabase project (additive only,
-- IF NOT EXISTS everywhere, no existing columns/tables touched).
-- Run in Supabase SQL editor, review output, then
-- `NOTIFY pgrst, 'reload schema';` at the end (included below).
-- ============================================================

-- ------------------------------------------------------------
-- 1. driver_gig_verification
-- Two-tier driver certification (§5.4 of planning notes)
-- ------------------------------------------------------------
create table if not exists public.driver_gig_verification (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,

  tier text not null default 'none'
    check (tier in ('none', 'delivery_ready', 'passenger_ready')),

  -- Delivery-Ready required docs
  drivers_license_url text,
  id_document_url text,
  selfie_url text,

  -- Additional docs required for Passenger-Ready only
  pdp_url text,                       -- Professional Driving Permit
  police_clearance_url text,

  -- Admin review state (mirrors existing profiles.*_verified pattern)
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,

  verified_at timestamp with time zone,
  verified_by uuid references public.profiles(id),

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  unique (driver_id)
);

comment on table public.driver_gig_verification is
  'Tracks Gig-Ready driver tier (free, functional gate — see planning §5.4, §5.11)';

-- ------------------------------------------------------------
-- 2. Ride-Ready vehicle certification — added to existing vehicles table
-- (§5.5). Only relevant for vehicles doing passenger-transport gigs.
-- ------------------------------------------------------------
alter table public.vehicles
  add column if not exists ride_ready_status text not null default 'not_submitted'
    check (ride_ready_status in ('not_submitted', 'pending', 'approved', 'rejected'));

alter table public.vehicles
  add column if not exists roadworthy_certificate_url text;

alter table public.vehicles
  add column if not exists roadworthy_expiry_date date;

alter table public.vehicles
  add column if not exists roadworthy_testing_station text;

alter table public.vehicles
  add column if not exists ride_ready_verified_at timestamp with time zone;

alter table public.vehicles
  add column if not exists ride_ready_verified_by uuid references public.profiles(id);

-- ------------------------------------------------------------
-- 3. gig_requests — core table (§5.2, §5.3, §5.8)
-- customer_id references ANY profile — no dedicated customer role.
-- ------------------------------------------------------------
create table if not exists public.gig_requests (
  id bigint generated always as identity primary key,

  gig_type text not null check (gig_type in ('ride', 'delivery')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'in_progress', 'completed', 'disputed', 'cancelled')),

  customer_id uuid not null references public.profiles(id),
  driver_id uuid references public.profiles(id),
  vehicle_id bigint references public.vehicles(id),

  -- Location (kept simple: text address + optional coordinates;
  -- follows existing vehicles.location / vehicles.geo_location pattern)
  pickup_address text not null,
  pickup_geo_location geography(point),
  dropoff_address text not null,
  dropoff_geo_location geography(point),

  -- Delivery-specific optional fields
  delivery_notes text,
  recipient_name text,
  recipient_phone text,

  fare_amount numeric,
  commission_amount numeric,
  driver_payout_amount numeric,

  -- Completion / dispute flow (§5.8)
  driver_completed_at timestamp with time zone,
  customer_confirmed_at timestamp with time zone,
  auto_confirmed boolean not null default false,   -- true if 24h timeout triggered release
  dispute_reason text,

  created_at timestamp with time zone not null default now(),
  accepted_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

comment on table public.gig_requests is
  'Ride/delivery requests — the core of the Gigs feature (§5.2 planning notes)';

create index if not exists idx_gig_requests_customer on public.gig_requests(customer_id);
create index if not exists idx_gig_requests_driver on public.gig_requests(driver_id);
create index if not exists idx_gig_requests_status on public.gig_requests(status);

-- ------------------------------------------------------------
-- 4. gig_earnings_ledger — read-only balance, NOT a spendable wallet (§5.7)
-- ------------------------------------------------------------
create table if not exists public.gig_earnings_ledger (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  gig_request_id bigint not null references public.gig_requests(id),

  amount numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'available', 'withdrawn')),

  created_at timestamp with time zone not null default now(),
  available_at timestamp with time zone,   -- set when funds released (§5.8)
  withdrawn_at timestamp with time zone,

  unique (gig_request_id)   -- one ledger entry per completed gig
);

comment on table public.gig_earnings_ledger is
  'Ledger only — driver never has a spendable in-app balance (§5.7). Money moves via withdrawal_requests + bank payout.';

create index if not exists idx_gig_earnings_driver on public.gig_earnings_ledger(driver_id);

-- ------------------------------------------------------------
-- 5. withdrawal_requests — "Withdraw to bank" action (§5.7)
-- ------------------------------------------------------------
create table if not exists public.withdrawal_requests (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,

  amount numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'rejected')),

  bank_account_holder text,
  bank_name text,
  bank_account_number text,
  bank_branch_code text,

  requested_at timestamp with time zone not null default now(),
  processed_at timestamp with time zone,
  processed_by uuid references public.profiles(id),
  rejection_reason text
);

comment on table public.withdrawal_requests is
  'Driver payout requests from the Client Funds account (§5.6, §5.7)';

create index if not exists idx_withdrawal_driver on public.withdrawal_requests(driver_id);

-- ------------------------------------------------------------
-- 6. messages — add context columns (§5.9)
-- Determined by UI entry point at creation time, never inferred
-- from content. Existing rental_id column stays as-is for
-- backward compatibility with existing rental-context rows.
-- ------------------------------------------------------------
alter table public.messages
  add column if not exists context_type text
    check (context_type in ('rental', 'gig'));

alter table public.messages
  add column if not exists context_id bigint;

-- Backfill: existing rows are all rental-context messages tied to rental_id
update public.messages
  set context_type = 'rental', context_id = rental_id
  where context_type is null and rental_id is not null;

create index if not exists idx_messages_context on public.messages(context_type, context_id);

-- ============================================================
-- RLS — enabled with explicit policies on every new table
-- (per §3.2 lesson: enabled-with-zero-policies silently blocks
-- everything for non-service-role clients)
-- ============================================================

alter table public.driver_gig_verification enable row level security;
alter table public.gig_requests enable row level security;
alter table public.gig_earnings_ledger enable row level security;
alter table public.withdrawal_requests enable row level security;

-- driver_gig_verification: driver can see/manage their own row
create policy "driver can view own verification"
  on public.driver_gig_verification for select
  using (auth.uid() = driver_id);

create policy "driver can insert own verification"
  on public.driver_gig_verification for insert
  with check (auth.uid() = driver_id);

create policy "driver can update own pending verification"
  on public.driver_gig_verification for update
  using (auth.uid() = driver_id and status = 'pending');

-- gig_requests: customer and assigned driver can see their own gigs
create policy "customer can view own gig requests"
  on public.gig_requests for select
  using (auth.uid() = customer_id);

create policy "driver can view assigned gig requests"
  on public.gig_requests for select
  using (auth.uid() = driver_id);

create policy "customer can create gig requests"
  on public.gig_requests for insert
  with check (auth.uid() = customer_id);

-- NOTE: accepting a gig (setting driver_id on someone else's pending
-- request) and status transitions are NOT covered by a simple UPDATE
-- policy here — per §3.2, this needs a SECURITY DEFINER RPC
-- (e.g. accept_gig_request(gig_id)) that checks eligibility
-- (tier, ride-ready status) server-side. Deliberately not drafted
-- as a raw client-writable UPDATE policy. See TODO at bottom.

-- gig_earnings_ledger: driver can view own earnings only (read-only —
-- inserts/updates happen only via SECURITY DEFINER RPC or service role)
create policy "driver can view own earnings"
  on public.gig_earnings_ledger for select
  using (auth.uid() = driver_id);

-- withdrawal_requests: driver can view/create own requests
create policy "driver can view own withdrawal requests"
  on public.withdrawal_requests for select
  using (auth.uid() = driver_id);

create policy "driver can create own withdrawal requests"
  on public.withdrawal_requests for insert
  with check (auth.uid() = driver_id);

-- Reload PostgREST schema cache (§3.2 lesson — policies can appear
-- correct in pg_policies but still serve stale errors without this)
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TODO — not included in this migration, needed before Gigs is usable:
--
-- 1. RPC: accept_gig_request(gig_id bigint)
--    SECURITY DEFINER, derives driver identity from auth.uid(),
--    checks driver_gig_verification.tier is sufficient for gig_type,
--    checks vehicle ride_ready_status = 'approved' if gig_type = 'ride',
--    then sets gig_requests.driver_id + status = 'accepted'.
--
-- 2. RPC: complete_gig_request(gig_id bigint) — driver-side "End Trip"
--    sets driver_completed_at, status stays 'in_progress' until
--    customer confirms (§5.8).
--
-- 3. RPC: confirm_gig_completion(gig_id bigint, confirmed boolean)
--    customer-side. If confirmed: releases funds, inserts
--    gig_earnings_ledger row with status='available', sets
--    gig_requests.status='completed'. If not confirmed: status='disputed'.
--
-- 4. Scheduled job (Netlify scheduled function or pg_cron): the
--    24-hour auto-confirm timeout (§5.8) — finds gig_requests where
--    driver_completed_at < now() - interval '24 hours' and
--    customer_confirmed_at is null, auto-releases funds.
--
-- 5. Admin RPC/function for approving driver_gig_verification and
--    vehicle ride_ready_status, following the admin-*.js Netlify
--    function pattern (§3.3) — service-role key + is_admin check.
--
-- 6. Withdrawal processing — admin-side function to mark
--    withdrawal_requests as paid and trigger the actual bank
--    transfer (manual or via a payments API), following §5.6/§5.7.
-- ============================================================
