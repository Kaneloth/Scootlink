-- ============================================================
-- Skootlink — Gigs feature: document expiry, renewals and the
-- Passenger-Ready upgrade path (handoff notes 8.8 and 8.9)
-- Branch: feature/ride-hailing
-- Depends on: 001, 004
--
-- Rules (agreed 2026-10-17):
--   * A renewal or upgrade is reviewed ALONGSIDE the current approval: a
--     vehicle stays Ride-Ready, and a driver keeps their tier, while the new
--     document is under review. Approval replaces the old document; rejection
--     leaves the current approval in place.
--   * Only the expiry date takes eligibility away (daily job):
--       - roadworthy certificate expired -> vehicle ride_ready_status 'expired'
--       - PDP expired -> Passenger-Ready driver drops to Delivery-Ready
--     with a reminder 14 days before each expiry (sent once per expiry date).
--   * Drivers approved as Passenger-Ready before this migration have no PDP
--     expiry on record, so they are never auto-downgraded until they renew.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 1. Vehicles: allow 'expired', and hold a pending renewal beside the live one
do $$
declare v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'vehicles' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%ride_ready_status%'
  loop
    execute format('alter table public.vehicles drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.vehicles
  add constraint vehicles_ride_ready_status_check
  check (ride_ready_status in ('not_submitted', 'pending', 'approved', 'rejected', 'expired'));

alter table public.vehicles add column if not exists renewal_status text
  check (renewal_status in ('pending', 'rejected'));
alter table public.vehicles add column if not exists renewal_certificate_url text;
alter table public.vehicles add column if not exists renewal_expiry_date date;
alter table public.vehicles add column if not exists renewal_testing_station text;
alter table public.vehicles add column if not exists renewal_rejection_reason text;
alter table public.vehicles add column if not exists renewal_requested_at timestamp with time zone;
alter table public.vehicles add column if not exists roadworthy_reminded_for date; -- expiry date last reminded about

-- 2. Drivers: PDP expiry, and an upgrade / PDP renewal beside the live tier
alter table public.driver_gig_verification add column if not exists pdp_expiry_date date;
alter table public.driver_gig_verification add column if not exists pdp_reminded_for date;
alter table public.driver_gig_verification add column if not exists upgrade_status text
  check (upgrade_status in ('pending', 'rejected'));
alter table public.driver_gig_verification add column if not exists upgrade_pdp_url text;
alter table public.driver_gig_verification add column if not exists upgrade_police_clearance_url text;
alter table public.driver_gig_verification add column if not exists upgrade_pdp_expiry_date date;
alter table public.driver_gig_verification add column if not exists upgrade_rejection_reason text;
alter table public.driver_gig_verification add column if not exists upgrade_requested_at timestamp with time zone;

-- 3. Daily expiry run (service role only; called by gig-document-expiry).
--    Applies the changes and returns the notifications to send.
create or replace function public.run_gig_document_expiry()
returns table (user_id uuid, ntype text, title text, body text, data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Vehicles whose certificate has expired
  for r in
    update public.vehicles v
    set ride_ready_status = 'expired'
    where v.ride_ready_status = 'approved'
      and v.roadworthy_expiry_date is not null
      and v.roadworthy_expiry_date < current_date
    returning v.id, v.owner_id, v.make, v.model
  loop
    user_id := r.owner_id; ntype := 'vehicle_ride_ready_expired';
    title := 'Roadworthy certificate expired';
    body := format('Your %s %s is no longer Ride-Ready. Upload a new roadworthy certificate to use it for rides again.', r.make, r.model);
    data := jsonb_build_object('vehicle_id', r.id);
    return next;
  end loop;

  -- Vehicles expiring within 14 days (once per expiry date)
  for r in
    update public.vehicles v
    set roadworthy_reminded_for = v.roadworthy_expiry_date
    where v.ride_ready_status = 'approved'
      and v.roadworthy_expiry_date between current_date and current_date + 14
      and v.roadworthy_reminded_for is distinct from v.roadworthy_expiry_date
      and v.renewal_status is distinct from 'pending'
    returning v.id, v.owner_id, v.make, v.model, v.roadworthy_expiry_date
  loop
    user_id := r.owner_id; ntype := 'vehicle_ride_ready_expiring';
    title := 'Roadworthy certificate expiring soon';
    body := format('The roadworthy certificate for your %s %s expires on %s. Upload the new one to stay Ride-Ready.',
                   r.make, r.model, to_char(r.roadworthy_expiry_date, 'DD Mon YYYY'));
    data := jsonb_build_object('vehicle_id', r.id);
    return next;
  end loop;

  -- Passenger-Ready drivers whose PDP has expired -> Delivery-Ready
  for r in
    update public.driver_gig_verification d
    set tier = 'delivery_ready', updated_at = now()
    where d.status = 'approved'
      and d.tier = 'passenger_ready'
      and d.pdp_expiry_date is not null
      and d.pdp_expiry_date < current_date
    returning d.driver_id
  loop
    user_id := r.driver_id; ntype := 'gig_pdp_expired';
    title := 'PDP expired — now Delivery-Ready';
    body := 'Your Professional Driving Permit has expired, so you can no longer accept rides. You can still do deliveries. Upload your renewed PDP to be Passenger-Ready again.';
    data := '{}'::jsonb;
    return next;
  end loop;

  -- PDPs expiring within 14 days (once per expiry date)
  for r in
    update public.driver_gig_verification d
    set pdp_reminded_for = d.pdp_expiry_date
    where d.status = 'approved'
      and d.tier = 'passenger_ready'
      and d.pdp_expiry_date between current_date and current_date + 14
      and d.pdp_reminded_for is distinct from d.pdp_expiry_date
      and d.upgrade_status is distinct from 'pending'
    returning d.driver_id, d.pdp_expiry_date
  loop
    user_id := r.driver_id; ntype := 'gig_pdp_expiring';
    title := 'PDP expiring soon';
    body := format('Your Professional Driving Permit expires on %s. Upload your renewed PDP to keep accepting rides.',
                   to_char(r.pdp_expiry_date, 'DD Mon YYYY'));
    data := '{}'::jsonb;
    return next;
  end loop;
end;
$$;

revoke execute on function public.run_gig_document_expiry() from public, anon, authenticated;
grant execute on function public.run_gig_document_expiry() to service_role;

commit;

NOTIFY pgrst, 'reload schema';
