-- ============================================================
-- Skootlink — Gigs feature: active trip steps, cancellation, one-at-a-time
-- Branch: feature/ride-hailing
-- Depends on: 007, 008
--
-- Adds (rules agreed 2026-10-17, easy to change later):
--  1. Columns to record the trip steps and cancellations.
--  2. gig_driver_arrived(gig)  — driver taps "I've arrived" (status stays
--     'accepted'; driver_arrived_at is set).
--  3. gig_start_trip(gig)      — driver taps "Start trip" -> 'in_progress'.
--  4. cancel_gig_request(gig, reason)
--       customer: while 'pending' or 'accepted' (not after the trip starts)
--       driver:   while 'accepted' (not after the trip starts)
--     The gig becomes 'cancelled'. No automatic re-matching yet.
--  5. One active gig per driver: accept_gig_request refuses a driver who
--     already has an 'accepted' or 'in_progress' gig, and matching no longer
--     offers gigs to such drivers.
--     (One open request per customer is enforced in create-gig-request.js.)
--
-- accept_gig_request is 008's version plus ONE added check (marked below).
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 1. Columns ---------------------------------------------------------------
alter table public.gig_requests add column if not exists driver_arrived_at timestamp with time zone;
alter table public.gig_requests add column if not exists started_at timestamp with time zone;
alter table public.gig_requests add column if not exists cancelled_at timestamp with time zone;
alter table public.gig_requests add column if not exists cancelled_by uuid references public.profiles(id);
alter table public.gig_requests add column if not exists cancellation_reason text;

-- 2. Driver arrived at pickup ----------------------------------------------
create or replace function public.gig_driver_arrived(p_gig_id bigint)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.gig_requests
  set driver_arrived_at = coalesce(driver_arrived_at, now()),
      updated_at = now()
  where id = p_gig_id
    and driver_id = auth.uid()
    and status = 'accepted'
  returning * into v_gig;

  if not found then
    raise exception 'This gig is not waiting for you at pickup';
  end if;

  return v_gig;
end;
$$;

-- 3. Start the trip --------------------------------------------------------
create or replace function public.gig_start_trip(p_gig_id bigint)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.gig_requests
  set status = 'in_progress',
      started_at = now(),
      driver_arrived_at = coalesce(driver_arrived_at, now()),
      updated_at = now()
  where id = p_gig_id
    and driver_id = auth.uid()
    and status = 'accepted'
  returning * into v_gig;

  if not found then
    raise exception 'This gig cannot be started';
  end if;

  return v_gig;
end;
$$;

-- 4. Cancel ----------------------------------------------------------------
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
  where id = p_gig_id
  returning * into v_gig;

  return v_gig;
end;
$$;

revoke execute on function public.gig_driver_arrived(bigint) from public, anon;
revoke execute on function public.gig_start_trip(bigint) from public, anon;
revoke execute on function public.cancel_gig_request(bigint, text) from public, anon;
grant execute on function public.gig_driver_arrived(bigint) to authenticated;
grant execute on function public.gig_start_trip(bigint) to authenticated;
grant execute on function public.cancel_gig_request(bigint, text) to authenticated;

-- 5a. Matching: skip drivers already on a gig --------------------------------
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
        and busy.status in ('accepted', 'in_progress')
    )
    and st_dwithin(dll.location, v_gig.pickup_geo_location, p_radius_meters)
    and (
      (v_gig.gig_type = 'delivery' and dgv.tier in ('delivery_ready', 'passenger_ready'))
      or (v_gig.gig_type = 'ride' and dgv.tier = 'passenger_ready')
    )
  order by 2 asc;
end;
$$;

revoke execute on function public.find_nearby_eligible_drivers(bigint, integer) from public, anon, authenticated;
grant execute on function public.find_nearby_eligible_drivers(bigint, integer) to service_role;

-- 5b. Accept: refuse a driver who is already on a gig ------------------------
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
  v_vehicle record;
begin
  if v_driver_id is null then
    raise exception 'Not signed in';
  end if;

  -- ADDED in 009: one active gig per driver
  if exists (
    select 1 from public.gig_requests
    where driver_id = v_driver_id and status in ('accepted', 'in_progress')
  ) then
    raise exception 'Finish your current gig before accepting another';
  end if;

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

    select id, owner_id, ride_ready_status into v_vehicle
    from public.vehicles
    where id = p_vehicle_id;

    if not found then
      raise exception 'Selected vehicle not found';
    end if;

    if v_vehicle.ride_ready_status is distinct from 'approved' then
      raise exception 'Selected vehicle is not Ride-Ready approved';
    end if;

    if not (
      exists (
        select 1 from public.rentals r
        where r.vehicle_id = p_vehicle_id
          and r.driver_id = v_driver_id
          and r.status = 'active'
      )
      or (
        v_vehicle.owner_id = v_driver_id
        and not exists (
          select 1 from public.rentals r
          where r.vehicle_id = p_vehicle_id
            and r.driver_id <> v_driver_id
            and r.status = 'active'
        )
      )
    ) then
      raise exception 'You can only use a vehicle you own (not rented out) or are currently renting';
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

revoke execute on function public.accept_gig_request(bigint, bigint) from public, anon;
grant execute on function public.accept_gig_request(bigint, bigint) to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
