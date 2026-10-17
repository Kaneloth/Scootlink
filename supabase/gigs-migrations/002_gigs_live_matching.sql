-- ============================================================
-- Skootlink — Gigs feature: live location + broadcast matching
-- Branch: feature/ride-hailing
-- Depends on: 001_gigs_schema.sql (gig_requests, driver_gig_verification)
-- Confirmed: PostGIS 3.3 enabled on this project.
--
-- Replaces the earlier "Gig Board" (customer browses drivers) concept.
-- Model: customer requests → system broadcasts to ALL eligible drivers
-- within radius simultaneously → first to accept wins (race-safe).
-- ============================================================

-- ------------------------------------------------------------
-- 1. driver_live_locations
-- One row per driver, overwritten continuously while
-- "Available for Gigs" is toggled on. NOT the same as
-- profiles.geo_location (that's a static, rarely-changing
-- geocode from an address — this is live GPS).
-- ------------------------------------------------------------
create table if not exists public.driver_live_locations (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  location geography(point) not null,
  is_available boolean not null default false,
  updated_at timestamp with time zone not null default now()
);

comment on table public.driver_live_locations is
  'Live GPS position, updated continuously while driver is available for gigs. Distinct from profiles.geo_location (static, address-based).';

-- Spatial index for fast radius queries
create index if not exists idx_driver_live_locations_geo
  on public.driver_live_locations using gist (location);

-- Partial index: most queries only care about currently-available drivers
create index if not exists idx_driver_live_locations_available
  on public.driver_live_locations (driver_id) where is_available = true;

alter table public.driver_live_locations enable row level security;

-- Driver can see/update only their own row directly (for reading their
-- own state back, e.g. confirming toggle status in the UI)
create policy "driver can view own live location"
  on public.driver_live_locations for select
  using (auth.uid() = driver_id);

-- NOTE: no direct client INSERT/UPDATE policy for driver_live_locations.
-- Writes go through update_driver_location() below (SECURITY DEFINER),
-- not raw client upserts — keeps validation (e.g. tier eligibility
-- checks later) centralized and consistent with §3.2 convention.

-- ------------------------------------------------------------
-- 2. update_driver_location — called frequently (e.g. every
-- 5-10s) by the driver's app while "Available for Gigs" is on.
-- SECURITY DEFINER, identity derived from auth.uid() only —
-- never trust a client-supplied driver_id (§3.2).
-- ------------------------------------------------------------
create or replace function public.update_driver_location(
  p_lat double precision,
  p_lng double precision,
  p_is_available boolean
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.driver_live_locations (driver_id, location, is_available, updated_at)
  values (
    auth.uid(),
    geography(st_setsrid(st_makepoint(p_lng, p_lat), 4326)),
    p_is_available,
    now()
  )
  on conflict (driver_id)
  do update set
    location = excluded.location,
    is_available = excluded.is_available,
    updated_at = excluded.updated_at;
end;
$$;

comment on function public.update_driver_location is
  'Driver app calls this periodically while Available for Gigs is on. Upserts live position.';

-- ------------------------------------------------------------
-- 3. find_nearby_eligible_drivers — used by the matching step.
-- Returns driver IDs (not full location data) within radius,
-- filtered by gig type eligibility (tier + vehicle ride-ready
-- status for rides). SECURITY DEFINER because this reads across
-- OTHER users' live location data — must not be a plain
-- client-facing RLS select (§3.2/§3.3: sensitive cross-user
-- reads go through a controlled function, not raw RLS).
--
-- Intended caller: a Netlify function using the service-role key
-- (matches the admin-function pattern in §3.3), triggered when a
-- gig_request is created — NOT called directly from the client.
-- ------------------------------------------------------------
create or replace function public.find_nearby_eligible_drivers(
  p_gig_id bigint,
  p_radius_meters integer default 5000
)
returns table (driver_id uuid, distance_meters double precision)
language plpgsql
security definer
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
    and dgv.status = 'approved'
    and st_dwithin(dll.location, v_gig.pickup_geo_location, p_radius_meters)
    and (
      v_gig.gig_type = 'delivery'
      -- delivery: either tier qualifies
      and dgv.tier in ('delivery_ready', 'passenger_ready')
      or (
        v_gig.gig_type = 'ride'
        and dgv.tier = 'passenger_ready'
        -- ride additionally requires the assigned vehicle to be ride-ready;
        -- checked at accept-time in accept_gig_request, since the specific
        -- vehicle a driver will use isn't known until they act.
      )
    )
  order by distance_meters asc;
end;
$$;

comment on function public.find_nearby_eligible_drivers is
  'Called by a service-role Netlify function to find who to broadcast a gig offer to. Not exposed to raw client calls.';

-- ------------------------------------------------------------
-- 4. accept_gig_request — race-safe accept (§3.2 pattern).
-- Broadcast-to-all means concurrent accepts are the EXPECTED
-- case, not an edge case — FOR UPDATE SKIP LOCKED guarantees
-- exactly one driver wins even under simultaneous taps.
-- ------------------------------------------------------------
create or replace function public.accept_gig_request(
  p_gig_id bigint,
  p_vehicle_id bigint default null
)
returns public.gig_requests
language plpgsql
security definer
as $$
declare
  v_gig public.gig_requests;
  v_driver_tier text;
  v_vehicle_ride_ready text;
begin
  -- Lock the row; SKIP LOCKED means a losing concurrent caller gets
  -- "not found" immediately rather than blocking and erroring later.
  select * into v_gig
  from public.gig_requests
  where id = p_gig_id and status = 'pending'
  for update skip locked;

  if not found then
    raise exception 'Gig no longer available';
  end if;

  select tier into v_driver_tier
  from public.driver_gig_verification
  where driver_id = auth.uid() and status = 'approved';

  if v_gig.gig_type = 'delivery' and v_driver_tier not in ('delivery_ready', 'passenger_ready') then
    raise exception 'Driver not eligible for delivery gigs';
  end if;

  if v_gig.gig_type = 'ride' then
    if v_driver_tier is distinct from 'passenger_ready' then
      raise exception 'Driver not eligible for ride gigs';
    end if;

    if p_vehicle_id is null then
      raise exception 'A vehicle must be specified for ride gigs';
    end if;

    select ride_ready_status into v_vehicle_ride_ready
    from public.vehicles
    where id = p_vehicle_id;

    if v_vehicle_ride_ready is distinct from 'approved' then
      raise exception 'Selected vehicle is not Ride-Ready approved';
    end if;
  end if;

  update public.gig_requests
  set driver_id = auth.uid(),
      vehicle_id = p_vehicle_id,
      status = 'accepted',
      accepted_at = now(),
      updated_at = now()
  where id = p_gig_id
  returning * into v_gig;

  return v_gig;
end;
$$;

comment on function public.accept_gig_request is
  'Driver-facing RPC. Atomically claims a pending gig; validates tier + (for rides) vehicle ride-ready status server-side.';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TODO — application layer, not SQL:
--
-- 1. Netlify function: create-gig-request.js
--    Creates the gig_requests row, then calls
--    find_nearby_eligible_drivers() (service role), then
--    broadcasts an offer via Supabase Realtime to each returned
--    driver_id on a per-driver channel (e.g.
--    `driver:{driver_id}:gig-offers`). All drivers get it at once
--    (broadcast-to-all, confirmed decision) — first accept wins.
--
-- 2. Driver app: subscribes to driver:{own_id}:gig-offers,
--    shows incoming offer card, calls accept_gig_request(gig_id,
--    vehicle_id) on tap. Handles the "already taken" exception
--    gracefully (another driver won) — just dismiss the card.
--
-- 3. Driver app: calls update_driver_location() on an interval
--    (~5-10s) while the "Available for Gigs" toggle is on; stops
--    calling (or calls once more with is_available=false) when
--    toggled off. Requires @capacitor/geolocation — NOT currently
--    in the plugin list (see handoff notes §2) — new native
--    dependency, needs AndroidManifest.xml location permissions
--    + a full native rebuild before Android users get this.
--
-- 4. Stale-location cleanup: a driver who force-quits the app
--    without toggling off will have a stuck is_available=true row.
--    Consider a scheduled job that sets is_available=false where
--    updated_at < now() - interval '2 minutes'.
-- ============================================================
