-- ============================================================
-- Skootlink — Gigs feature: rejection-reason columns
-- Branch: feature/ride-hailing
-- Depends on: 001_gigs_schema.sql
--
-- Gap caught while writing admin-gig-verification.js and
-- admin-vehicle-ride-ready.js: both reference a rejection_reason
-- column that 001 never created. driver_gig_verification already
-- had one (001 included it) — vehicles did not.
-- ============================================================

alter table public.vehicles
  add column if not exists ride_ready_rejection_reason text;

NOTIFY pgrst, 'reload schema';
