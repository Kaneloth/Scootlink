-- ============================================================
-- Skootlink — Gigs feature: accept + matching safety fixes
-- Branch: feature/ride-hailing
-- Depends on: 002 and 006 (replaces accept_gig_request and
-- find_nearby_eligible_drivers; same names, same parameters, same
-- return types, so the app code does not change).
--
-- Fixes (handoff notes 8.4, 8.5, plus problems found reading 002):
--  1. accept_gig_request let a driver with NO approved verification accept
--     a delivery: their tier was NULL, and `NULL not in (...)` is NULL, not
--     true, so the eligibility check never fired. Now an explicit check.
--  2. accept_gig_request had no sign-in check. With auth.uid() NULL (a
--     signed-out caller) and fix 1's hole, a delivery could be claimed by
--     nobody. Now refuses unless signed in.
--  3. A customer could receive and accept their own gig (8.4).
--  4. Banned, blacklisted or currently suspended drivers could receive and
--     accept gigs (8.5).
--  5. For rides, the server never checked that the driver actually rents
--     the vehicle they picked — any Ride-Ready vehicle id was accepted (8.5).
--     Now requires an 'active' rental of that vehicle by this driver.
--  6. Deliveries ignored, but stored, any vehicle id sent; now stored as NULL.
--  7. find_nearby_eligible_drivers could be called by anyone through the
--     public API, revealing which verified drivers are near a point and how
--     far. Only the service role (Netlify functions) needs it, so execute is
--     restricted to service_role.
--
-- Profile columns used: banned (boolean), blacklisted (boolean),
-- suspended_until (timestamptz) — as used in AdminUserManagement.jsx.
-- Rental status 'active' — as used in Activity.jsx / AdminRentalsOversight.jsx
-- and confirmed by `select status, count(*) from rentals`.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 1. Matching: exclude the customer and blocked drivers ---------------------
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
    and st_dwithin(dll.location, v_gig.pickup_geo_location, p_radius_meters)
    and (
      (v_gig.gig_type = 'delivery' and dgv.tier in ('delivery_ready', 'passenger_ready'))
      or (v_gig.gig_type = 'ride' and dgv.tier = 'passenger_ready')
      -- ride vehicle check happens at accept-time in accept_gig_request
    )
  order by 2 asc;
end;
$$;

-- Only Netlify functions (service role) call this.
revoke execute on function public.find_nearby_eligible_drivers(bigint, integer) from public, anon, authenticated;
grant execute on function public.find_nearby_eligible_drivers(bigint, integer) to service_role;

-- 2. Accept: every eligibility rule enforced server-side --------------------
create or replace function public.accept_gig_request(
  p_gig_id bigint,
  p_vehicle_id bigint default null
)
returns public.gig_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_driver_id uuid := auth.uid();
  v_gig public.gig_requests;
  v_driver_tier text;
  v_profile record;
  v_vehicle_ride_ready text;
begin
  if v_driver_id is null then
    raise exception 'Not signed in';
  end if;

  -- Lock the row; SKIP LOCKED means a losing concurrent caller gets
  -- "no longer available" immediately instead of blocking.
  select * into v_gig
  from public.gig_requests
  where id = p_gig_id and status = 'pending'
  for update skip locked;

  if not found then
    raise exception 'Gig no longer available';
  end if;

  if v_gig.customer_id = v_driver_id then
    raise exception 'You cannot accept your own gig';
  end if;

  select banned, blacklisted, suspended_until into v_profile
  from public.profiles
  where id = v_driver_id;

  if not found
     or v_profile.banned is true
     or v_profile.blacklisted is true
     or (v_profile.suspended_until is not null and v_profile.suspended_until > now()) then
    raise exception 'Your account cannot accept gigs right now';
  end if;

  select tier into v_driver_tier
  from public.driver_gig_verification
  where driver_id = v_driver_id and status = 'approved';

  if v_driver_tier is null or v_driver_tier not in ('delivery_ready', 'passenger_ready') then
    raise exception 'You are not Gig-Ready approved';
  end if;

  if v_gig.gig_type = 'ride' then
    if v_driver_tier <> 'passenger_ready' then
      raise exception 'Driver not eligible for ride gigs';
    end if;

    if p_vehicle_id is null then
      raise exception 'A vehicle must be specified for ride gigs';
    end if;

    if not exists (
      select 1 from public.rentals r
      where r.vehicle_id = p_vehicle_id
        and r.driver_id = v_driver_id
        and r.status = 'active'
    ) then
      raise exception 'You do not have an active rental on that vehicle';
    end if;

    select ride_ready_status into v_vehicle_ride_ready
    from public.vehicles
    where id = p_vehicle_id;

    if v_vehicle_ride_ready is distinct from 'approved' then
      raise exception 'Selected vehicle is not Ride-Ready approved';
    end if;
  end if;

  update public.gig_requests
  set driver_id = v_driver_id,
      vehicle_id = case when v_gig.gig_type = 'ride' then p_vehicle_id else null end,
      status = 'accepted',
      accepted_at = now(),
      updated_at = now()
  where id = p_gig_id
  returning * into v_gig;

  return v_gig;
end;
$$;

-- Signed-in drivers call this from the app; signed-out callers never need it.
revoke execute on function public.accept_gig_request(bigint, bigint) from public, anon;
grant execute on function public.accept_gig_request(bigint, bigint) to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
