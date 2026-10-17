-- ============================================================
-- Skootlink — Gigs feature: fare config + expiry/retry tracking
-- Branch: feature/ride-hailing
-- Depends on: 001_gigs_schema.sql, 002_gigs_live_matching.sql
--
-- Fare figures below are STARTING DEFAULTS only — based on a rough,
-- unverified comparison against Uber/Bolt/inDrive SA pricing (from an
-- AI planning conversation, not live-verified data). Treat as a
-- reasonable launch point, not researched fact. Admin-configurable
-- from day one, same pattern as signup_credits_driver/owner.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fare config on app_settings (singleton row, id = 1 —
-- matches the existing signup_credits_driver/owner pattern
-- read in grant-signup-credits.js)
-- ------------------------------------------------------------
alter table public.app_settings
  add column if not exists ride_minimum_fare numeric not null default 30.00;

alter table public.app_settings
  add column if not exists ride_per_km_rate numeric not null default 7.50;

alter table public.app_settings
  add column if not exists delivery_minimum_fare numeric not null default 25.00;

alter table public.app_settings
  add column if not exists delivery_per_km_rate numeric not null default 6.00;

comment on column public.app_settings.ride_minimum_fare is
  'Minimum ride fare (covers first 2km). Starting default, not researched — see 003 migration header.';
comment on column public.app_settings.delivery_minimum_fare is
  'Minimum delivery fare (covers first 2km). Starting default, not researched — see 003 migration header.';

-- ------------------------------------------------------------
-- 2. Expiry/retry tracking on gig_requests
-- ------------------------------------------------------------
alter table public.gig_requests
  add column if not exists retry_count integer not null default 0;

alter table public.gig_requests
  add column if not exists search_radius_meters integer;

-- 'no_drivers_available' added as a distinct terminal status,
-- separate from 'cancelled' (customer-initiated) — lets you
-- report on match-failure rate separately from cancellations.
alter table public.gig_requests
  drop constraint if exists gig_requests_status_check;

alter table public.gig_requests
  add constraint gig_requests_status_check
  check (status in ('pending', 'accepted', 'in_progress', 'completed', 'disputed', 'cancelled', 'no_drivers_available'));

NOTIFY pgrst, 'reload schema';
