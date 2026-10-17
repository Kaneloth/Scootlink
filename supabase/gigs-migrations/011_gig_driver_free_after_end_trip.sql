-- ============================================================
-- Skootlink — Gigs feature: a driver who has ended a trip is free again
-- Branch: feature/ride-hailing
-- Depends on: 009, 010
--
-- 009 treated a driver as busy while any gig of theirs was 'accepted' or
-- 'in_progress'. But after the driver taps End trip (010), the gig stays
-- 'in_progress' until the customer confirms — up to 24 hours — so the driver
-- got no offers and couldn't accept one during that wait.
--
-- Now "busy" means: status 'accepted', or 'in_progress' with
-- driver_completed_at still empty. Replaces find_nearby_eligible_drivers and
-- accept_gig_request from 009; that busy condition is the ONLY change.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 1. Matching: skip drivers on an unfinished trip --------------------------------
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
  order by 2 asc;
end;
$$;

revoke execute on function public.find_nearby_eligible_drivers(bigint, integer) from public, anon, authenticated;
grant execute on function public.find_nearby_eligible_drivers(bigint, integer) to service_role;

-- 2. Accept: refuse a driver who is on an unfinished trip ------------------------
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

  -- One active gig per driver. A trip the driver has ENDED (waiting only for
  -- the customer's confirmation) no longer counts as active (changed in 011).
  if exists (
    select 1 from public.gig_requests
    where driver_id = v_driver_id
      and (status = 'accepted'
           or (status = 'in_progress' and driver_completed_at is null))
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
