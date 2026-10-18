-- ============================================================
-- Skootlink — Gigs feature: owners may use their own Ride-Ready vehicles
-- Branch: feature/ride-hailing
-- Depends on: 007_gig_accept_and_matching_safety.sql
--
-- Decision (Kanelo, 2026-10-17): a driver may accept a ride in a Ride-Ready
-- approved vehicle that they EITHER
--   - currently rent (rentals.status = 'active'), OR
--   - own, as long as it is not actively rented out to someone else.
--
-- Replaces accept_gig_request from 007. The ONLY change is the
-- "which vehicle may this driver use" check; everything else is identical.
-- Same name, parameters and return type, so the app code does not change.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

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

    select id, owner_id, ride_ready_status into v_vehicle
    from public.vehicles
    where id = p_vehicle_id;

    if not found then
      raise exception 'Selected vehicle not found';
    end if;

    if v_vehicle.ride_ready_status is distinct from 'approved' then
      raise exception 'Selected vehicle is not Ride-Ready approved';
    end if;

    -- May this driver use this vehicle? Either they rent it right now, or
    -- they own it and nobody else is renting it right now.
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

-- Same permissions as 007 (create or replace keeps them; restated for safety).
revoke execute on function public.accept_gig_request(bigint, bigint) from public, anon;
grant execute on function public.accept_gig_request(bigint, bigint) to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
