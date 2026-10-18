-- ============================================================
-- Skootlink — Gigs feature: realtime authorization + availability hardening
-- Branch: feature/ride-hailing
-- Depends on: 002_gigs_live_matching.sql (if any ALTER FUNCTION below says
-- "function ... does not exist", 002 was never applied — run it first).
--
-- Fixes found before the first end-to-end test:
--  1. Offers are broadcast on PRIVATE channels (create-gig-request.js), but the
--     client subscribed to a public channel of the same name — Supabase treats
--     those as two unrelated channels, so no offer would ever arrive. Private
--     channels need an RLS policy on realtime.messages (below) + the client
--     joining with private:true (useGigOffers.js updated to match).
--  2. find_nearby_eligible_drivers now ignores locations older than 2 minutes,
--     so a closed tab can't keep receiving offers even if no cleanup job ran.
--  3. set_driver_unavailable() — lets the app flip a driver offline without
--     needing coordinates (clients have no direct UPDATE on driver_live_locations).
--  4. search_path pinned on the SECURITY DEFINER functions (Supabase linter
--     advisory; also guards against PostGIS living in the `extensions` schema).
-- ============================================================

-- 1. Realtime Authorization: a driver may only receive offers on their own topic
drop policy if exists "drivers can receive own gig offers" on realtime.messages;
create policy "drivers can receive own gig offers"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'driver:' || (select auth.uid())::text || ':gig-offers'
  );

-- 2. Matching: freshness-aware (replaces the 002 version; only changes are the
--    updated_at filter, search_path, and ORDER BY position)
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
  where dll.is_available = true
    and dll.updated_at > now() - interval '2 minutes'
    and dgv.status = 'approved'
    and st_dwithin(dll.location, v_gig.pickup_geo_location, p_radius_meters)
    and (
      (v_gig.gig_type = 'delivery' and dgv.tier in ('delivery_ready', 'passenger_ready'))
      or (v_gig.gig_type = 'ride' and dgv.tier = 'passenger_ready')
      -- ride vehicle check happens at accept-time in accept_gig_request
    )
  order by 2 asc;
end;
$$;

-- 3. Go offline without coordinates
create or replace function public.set_driver_unavailable()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.driver_live_locations
  set is_available = false, updated_at = now()
  where driver_id = auth.uid();
end;
$$;

-- 4. Pin search_path on the other two SECURITY DEFINER functions from 002
alter function public.update_driver_location(double precision, double precision, boolean)
  set search_path = public, extensions;
alter function public.accept_gig_request(bigint, bigint)
  set search_path = public, extensions;

NOTIFY pgrst, 'reload schema';
