-- ============================================================
-- Skootlink — Vehicle listing routes, listing fee, and vehicles security
-- Branch: feature/ride-hailing
-- Depends on: 001, 016 (ride-ready columns), 018 (platform_payments)
--
-- PART A — SECURITY (found 2026-10-18 while reading the live schema)
--   Two vehicles policies let ANY signed-in user update or insert ANY vehicle
--   ("Allow UPDATE for authenticated users": using true / check true, and
--   "Allow authenticated users to insert vehicles": check true). Policies are
--   OR'd, so the owner-only ones didn't help: anyone could change anyone's
--   car, or mark their own car Ride-Ready approved without admin review.
--   Fix:
--     * drop those two policies (owner-only policies remain);
--     * a trigger stops app users changing protected columns even on their
--       own vehicles (listing state/dates, Ride-Ready and roadworthy fields,
--       owner, purpose, draft deadline). Those change only through
--       SECURITY DEFINER functions or the service role (Netlify functions);
--     * a vehicle's rented/available status now follows its rental (trigger),
--       because the DRIVER ending a rental could only update the vehicle
--       through the permissive policy.
--
-- PART B — LISTING ROUTES (decided 2026-10-18)
--   Every new vehicle has a purpose: 'rental', 'gigs' or 'both'.
--     rental / both: hidden draft until the listing fee is paid (PayFast) —
--       or the owner's FIRST listing ever is free. A listing runs
--       app_settings.listing_period_months (default 6) and then needs the fee
--       again to relist (default R149). Reminders: existing 7/3/1-day job.
--     gigs / both: needs the roadworthy certificate (Ride-Ready review).
--     A gigs-only vehicle never appears in the rental marketplace
--     (listing_state 'not_listed').
--   Drafts: a new vehicle that completes NO step (no paid/free listing, no
--   roadworthy submission) within 7 days is deleted with its photos by the
--   daily vehicle-expiry-check job — unless it has rental or gig history.
--   Existing vehicles keep working: they get a purpose from what they already
--   have and are never auto-deleted.
--
-- New tables are created WITHOUT "if not exists" on purpose (stop, don't reuse).
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- ── A1. Drop the permissive policies ─────────────────────────────────────────
drop policy if exists "Allow UPDATE for authenticated users" on public.vehicles;
drop policy if exists "Allow authenticated users to insert vehicles" on public.vehicles;

-- ── B1. Settings ───────────────────────────────────────────────────────────────
alter table public.app_settings add column if not exists listing_fee numeric not null default 149;
alter table public.app_settings add column if not exists listing_period_months integer not null default 6;

-- ── B2. Vehicle columns ────────────────────────────────────────────────────────
alter table public.vehicles add column if not exists listing_purpose text
  check (listing_purpose in ('rental', 'gigs', 'both'));
alter table public.vehicles add column if not exists draft_expires_at timestamp with time zone;
alter table public.vehicles add column if not exists draft_reminder_sent boolean not null default false;

-- listing_state: + 'draft' (rental listing not paid yet), + 'not_listed' (gigs only)
alter table public.vehicles drop constraint if exists vehicles_listing_state_check;
alter table public.vehicles
  add constraint vehicles_listing_state_check
  check (listing_state in ('active', 'expired', 'draft', 'not_listed'));

-- Existing vehicles: purpose from what they already have; never auto-deleted
update public.vehicles
set listing_purpose = case
      when ride_ready_status in ('pending', 'approved', 'expired')
        then case when listing_state = 'active' then 'both' else 'gigs' end
      else 'rental'
    end
where listing_purpose is null;
update public.vehicles set listing_state = 'not_listed'
where listing_purpose = 'gigs' and listing_state = 'expired';

-- ── B3. Listing periods (paid or free) ─────────────────────────────────────────
create table public.listing_periods (
  id bigint generated always as identity primary key,
  vehicle_id bigint not null references public.vehicles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  payment_id bigint unique references public.platform_payments(id),
  is_free boolean not null default false,
  created_at timestamp with time zone not null default now(),
  check (is_free = (payment_id is null))
);
create index idx_listing_periods_owner on public.listing_periods (owner_id);
alter table public.listing_periods enable row level security;
create policy "owners read own listing periods" on public.listing_periods
  for select using (auth.uid() = owner_id);

-- ── A2. Inserts by app users: safe starting values ─────────────────────────────
-- set_vehicle_expiry (production) gave every new vehicle a 6-month expiry; now
-- only an ACTIVE listing has one (service-role inserts keep the old behaviour).
create or replace function public.set_vehicle_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.listed_at is null then
    new.listed_at := now();
  end if;
  if new.expires_at is null and new.listing_state = 'active' then
    new.expires_at := new.listed_at + interval '6 months';
  end if;
  return new;
end;
$$;

-- NOT security definer: it must see the caller's role in current_user
-- ('authenticated' for app users; the function owner inside other
-- SECURITY DEFINER functions; 'service_role' for Netlify functions).
create or replace function public._vehicles_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only app users (PostgREST roles); service role / definer functions are trusted
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if auth.uid() is null or new.owner_id is distinct from auth.uid() then
    raise exception 'You can only add vehicles to your own account';
  end if;
  if new.listing_purpose is null then
    raise exception 'Choose what this vehicle is for: rental, gigs or both';
  end if;

  new.listing_state := case when new.listing_purpose = 'gigs' then 'not_listed' else 'draft' end;
  new.listed_at := now();
  new.expires_at := null;
  new.grace_expires_at := null;
  new.reminder_7d_sent := false;
  new.reminder_3d_sent := false;
  new.reminder_1d_sent := false;
  new.draft_expires_at := now() + interval '7 days';
  new.draft_reminder_sent := false;
  new.ride_ready_status := 'not_submitted';
  new.roadworthy_certificate_url := null;
  new.roadworthy_expiry_date := null;
  new.roadworthy_testing_station := null;
  new.ride_ready_verified_at := null;
  new.ride_ready_verified_by := null;
  new.ride_ready_rejection_reason := null;
  new.renewal_status := null;
  new.renewal_certificate_url := null;
  new.renewal_expiry_date := null;
  new.renewal_testing_station := null;
  new.renewal_rejection_reason := null;
  new.renewal_requested_at := null;
  new.roadworthy_reminded_for := null;
  return new;
end;
$$;
revoke execute on function public._vehicles_insert_guard() from public, anon, authenticated;

drop trigger if exists trg_vehicles_insert_guard on public.vehicles;
create trigger trg_vehicles_insert_guard
  before insert on public.vehicles
  for each row execute function public._vehicles_insert_guard();

-- ── A3. Updates by app users: protected columns stay put ───────────────────────
-- NOT security definer: it must see the caller's role in current_user
-- ('authenticated' for app users; the function owner inside other
-- SECURITY DEFINER functions; 'service_role' for Netlify functions).
create or replace function public._vehicles_update_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.listing_purpose is distinct from old.listing_purpose
     or new.listing_state is distinct from old.listing_state
     or new.listed_at is distinct from old.listed_at
     or new.expires_at is distinct from old.expires_at
     or new.grace_expires_at is distinct from old.grace_expires_at
     or new.reminder_7d_sent is distinct from old.reminder_7d_sent
     or new.reminder_3d_sent is distinct from old.reminder_3d_sent
     or new.reminder_1d_sent is distinct from old.reminder_1d_sent
     or new.draft_expires_at is distinct from old.draft_expires_at
     or new.draft_reminder_sent is distinct from old.draft_reminder_sent
     or new.ride_ready_status is distinct from old.ride_ready_status
     or new.roadworthy_certificate_url is distinct from old.roadworthy_certificate_url
     or new.roadworthy_expiry_date is distinct from old.roadworthy_expiry_date
     or new.roadworthy_testing_station is distinct from old.roadworthy_testing_station
     or new.ride_ready_verified_at is distinct from old.ride_ready_verified_at
     or new.ride_ready_verified_by is distinct from old.ride_ready_verified_by
     or new.ride_ready_rejection_reason is distinct from old.ride_ready_rejection_reason
     or new.renewal_status is distinct from old.renewal_status
     or new.renewal_certificate_url is distinct from old.renewal_certificate_url
     or new.renewal_expiry_date is distinct from old.renewal_expiry_date
     or new.renewal_testing_station is distinct from old.renewal_testing_station
     or new.renewal_rejection_reason is distinct from old.renewal_rejection_reason
     or new.renewal_requested_at is distinct from old.renewal_requested_at
     or new.roadworthy_reminded_for is distinct from old.roadworthy_reminded_for then
    raise exception 'These vehicle details can only be changed by Skootlink (listing, purpose or Ride-Ready fields)';
  end if;
  return new;
end;
$$;
revoke execute on function public._vehicles_update_guard() from public, anon, authenticated;

drop trigger if exists trg_vehicles_update_guard on public.vehicles;
create trigger trg_vehicles_update_guard
  before update on public.vehicles
  for each row execute function public._vehicles_update_guard();

-- A draft stops being a draft once any step is done (any role, runs after the guard)
create or replace function public._vehicles_draft_done()
returns trigger
language plpgsql
as $$
begin
  if new.draft_expires_at is not null
     and (new.listing_state = 'active' or new.ride_ready_status in ('pending', 'approved')) then
    new.draft_expires_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vehicles_zz_draft_done on public.vehicles;
create trigger trg_vehicles_zz_draft_done
  before update on public.vehicles
  for each row execute function public._vehicles_draft_done();

-- ── A4. Vehicle status follows its rental ──────────────────────────────────────
create or replace function public._rental_sync_vehicle_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vehicle_id is null then
    return null;
  end if;
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.vehicles set status = 'rented' where id = new.vehicle_id;
  elsif old.status = 'active' and new.status is distinct from 'active'
        and not exists (select 1 from public.rentals r
                        where r.vehicle_id = new.vehicle_id and r.status = 'active' and r.id <> new.id) then
    update public.vehicles set status = 'available' where id = new.vehicle_id;
  end if;
  return null;
end;
$$;
revoke execute on function public._rental_sync_vehicle_status() from public, anon, authenticated;

drop trigger if exists trg_rental_sync_vehicle_status on public.rentals;
create trigger trg_rental_sync_vehicle_status
  after update of status on public.rentals
  for each row execute function public._rental_sync_vehicle_status();

-- ── B3b. Drivers only find active rental listings ──────────────────────────────
-- Both search functions (production definitions, introspected 2026-10-18)
-- returned every vehicle with status 'available' — including expired
-- listings, and now drafts and gigs-only vehicles. Same signatures and order;
-- only "listing_state = 'active'" is added.
create or replace function public.get_nearby_vehicles(p_user_id uuid, p_radius_meters integer default 50000)
returns setof public.vehicles
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_location geography;
begin
  select geo_location into v_user_location from public.profiles where id = p_user_id;

  if v_user_location is null then
    return query
      select * from public.vehicles
      where status = 'available' and listing_state = 'active' and owner_id != p_user_id
      order by created_at desc;
  else
    return query
      select * from public.vehicles
      where status = 'available'
        and listing_state = 'active'
        and owner_id != p_user_id
        and geo_location is not null
        and st_dwithin(geo_location, v_user_location, p_radius_meters)
      order by st_distance(geo_location, v_user_location);
  end if;
end;
$$;

create or replace function public.nearby_vehicles(search_lat double precision, search_lng double precision, radius_km double precision default 50)
returns setof public.vehicles
language sql
stable
set search_path = public, extensions
as $$
  select *
  from public.vehicles
  where geo_location is not null
    and listing_state = 'active'
    and st_dwithin(
      geo_location,
      st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography,
      radius_km * 1000
    )
  order by st_distance(
    geo_location,
    st_setsrid(st_makepoint(search_lng, search_lat), 4326)::geography
  )
  limit 100;
$$;

-- ── B4. Activating a listing (internal) ────────────────────────────────────────
-- Starts now, or — relisting early — when the current listing ends.
create or replace function public._activate_listing(p_vehicle_id bigint, p_payment_id bigint, p_free boolean)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles;
  v_months integer;
  v_start timestamp with time zone;
begin
  select coalesce(listing_period_months, 6) into v_months from public.app_settings where id = 1;
  v_months := coalesce(v_months, 6);

  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  v_start := case when v_vehicle.listing_state = 'active' and v_vehicle.expires_at > now()
                  then v_vehicle.expires_at else now() end;

  update public.vehicles
  set listing_state = 'active',
      listed_at = case when v_vehicle.listing_state = 'active' then listed_at else now() end,
      expires_at = v_start + make_interval(months => v_months),
      grace_expires_at = null,
      reminder_7d_sent = false,
      reminder_3d_sent = false,
      reminder_1d_sent = false
  where id = p_vehicle_id
  returning * into v_vehicle;

  insert into public.listing_periods (vehicle_id, owner_id, starts_at, ends_at, payment_id, is_free)
  values (p_vehicle_id, v_vehicle.owner_id, v_start, v_vehicle.expires_at, p_payment_id, p_free);

  return v_vehicle;
end;
$$;
revoke execute on function public._activate_listing(bigint, bigint, boolean) from public, anon, authenticated;

-- ── B5. What listing costs the signed-in owner ─────────────────────────────────
create or replace function public.listing_offer()
returns table (fee numeric, period_months integer, free_available boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.listing_fee, 149), coalesce(s.listing_period_months, 6),
         not exists (select 1 from public.listing_periods lp where lp.owner_id = auth.uid())
  from public.app_settings s where s.id = 1;
$$;

-- ── B6. The free first listing ─────────────────────────────────────────────────
create or replace function public.start_free_listing(p_vehicle_id bigint)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_vehicle public.vehicles;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  -- one owner at a time, so two vehicles can't both take the free listing
  perform pg_advisory_xact_lock(hashtext('free_listing:' || v_uid::text));

  select * into v_vehicle from public.vehicles where id = p_vehicle_id;
  if not found or v_vehicle.owner_id <> v_uid then
    raise exception 'Vehicle not found';
  end if;
  if v_vehicle.listing_purpose not in ('rental', 'both') then
    raise exception 'This vehicle is not listed for rental';
  end if;
  if v_vehicle.listing_state = 'active' then
    raise exception 'This vehicle is already listed';
  end if;
  if exists (select 1 from public.listing_periods where owner_id = v_uid) then
    raise exception 'Your free listing has already been used';
  end if;

  return public._activate_listing(p_vehicle_id, null, true);
end;
$$;

-- ── B7. Listing fee received (PayFast ITN, service role only) ──────────────────
-- activated | duplicate | amount_mismatch (paid less: nothing activated, refund
-- by hand) | vehicle_missing (deleted meanwhile: refund by hand) | unknown
create or replace function public.mark_listing_fee_paid(
  p_m_payment_id text,
  p_pf_payment_id text,
  p_amount numeric
)
returns table (vehicle_id bigint, owner_id uuid, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.platform_payments;
begin
  select * into v_pay from public.platform_payments
  where m_payment_id = p_m_payment_id and kind = 'listing_fee'
  for update;
  if not found then
    return query select null::bigint, null::uuid, 'unknown'::text;
    return;
  end if;
  if v_pay.status = 'paid' then
    return query select v_pay.vehicle_id, v_pay.user_id, 'duplicate'::text;
    return;
  end if;

  update public.platform_payments
  set status = 'paid', pf_payment_id = p_pf_payment_id, paid_at = now()
  where id = v_pay.id;

  if coalesce(p_amount, 0) < v_pay.amount - 0.01 then
    return query select v_pay.vehicle_id, v_pay.user_id, 'amount_mismatch'::text;
    return;
  end if;
  if not exists (select 1 from public.vehicles v where v.id = v_pay.vehicle_id and v.owner_id = v_pay.user_id) then
    return query select v_pay.vehicle_id, v_pay.user_id, 'vehicle_missing'::text;
    return;
  end if;

  perform public._activate_listing(v_pay.vehicle_id, v_pay.id, false);
  return query select v_pay.vehicle_id, v_pay.user_id, 'activated'::text;
end;
$$;

-- ── B8. Changing what a vehicle is for ─────────────────────────────────────────
create or replace function public.set_listing_purpose(p_vehicle_id bigint, p_purpose text)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.vehicles;
begin
  if p_purpose not in ('rental', 'gigs', 'both') then
    raise exception 'Purpose must be rental, gigs or both';
  end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if not found or v_vehicle.owner_id is distinct from auth.uid() then
    raise exception 'Vehicle not found';
  end if;
  if p_purpose = 'gigs' and v_vehicle.listing_state = 'active'
     and exists (select 1 from public.rentals r where r.vehicle_id = p_vehicle_id
                 and r.status in ('pending', 'awaiting_driver_confirmation', 'driver_accepted')) then
    raise exception 'This vehicle has rental proposals in progress. Finish or withdraw them first';
  end if;

  update public.vehicles
  set listing_purpose = p_purpose,
      listing_state = case
        when p_purpose = 'gigs' then 'not_listed'
        when listing_state = 'not_listed' then 'draft'
        else listing_state end
  where id = p_vehicle_id
  returning * into v_vehicle;
  return v_vehicle;
end;
$$;

-- ── B9. Drafts nobody finished (daily job, service role only) ───────────────────
-- Owners whose drafts end within 2 days, not yet reminded (marks them reminded)
create or replace function public.remind_expiring_drafts()
returns table (vehicle_id bigint, owner_id uuid, make text, model text, draft_expires_at timestamp with time zone)
language sql
security definer
set search_path = public
as $$
  update public.vehicles v
  set draft_reminder_sent = true
  where v.draft_expires_at is not null
    and v.draft_expires_at <= now() + interval '2 days'
    and v.draft_expires_at > now()
    and not v.draft_reminder_sent
  returning v.id, v.owner_id, v.make, v.model, v.draft_expires_at;
$$;

-- Deletes expired drafts with no history; returns their photos so the job can
-- remove them from Storage. A draft that something else still points at (a
-- foreign key this file doesn't know about) is kept and stops being a draft.
create or replace function public.delete_expired_drafts()
returns table (vehicle_id bigint, owner_id uuid, make text, model text, images jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  for v in
    select * from public.vehicles d
    where d.draft_expires_at is not null
      and d.draft_expires_at <= now()
      and d.listing_state <> 'active'
      and d.ride_ready_status not in ('pending', 'approved')
      and not exists (select 1 from public.rentals r where r.vehicle_id = d.id)
      and not exists (select 1 from public.gig_requests g where g.vehicle_id = d.id)
      and not exists (select 1 from public.listing_periods lp where lp.vehicle_id = d.id)
      and not exists (select 1 from public.platform_payments p where p.vehicle_id = d.id and p.status = 'paid')
    for update skip locked
  loop
    begin
      delete from public.vehicles where id = v.id;
      vehicle_id := v.id; owner_id := v.owner_id; make := v.make; model := v.model; images := v.images;
      return next;
    exception when foreign_key_violation then
      update public.vehicles set draft_expires_at = null where id = v.id;
    end;
  end loop;
end;
$$;

-- ── Permissions ────────────────────────────────────────────────────────────────
revoke execute on function public.listing_offer() from public, anon;
revoke execute on function public.start_free_listing(bigint) from public, anon;
revoke execute on function public.set_listing_purpose(bigint, text) from public, anon;
revoke execute on function public.mark_listing_fee_paid(text, text, numeric) from public, anon, authenticated;
revoke execute on function public.remind_expiring_drafts() from public, anon, authenticated;
revoke execute on function public.delete_expired_drafts() from public, anon, authenticated;
grant execute on function public.listing_offer() to authenticated;
grant execute on function public.start_free_listing(bigint) to authenticated;
grant execute on function public.set_listing_purpose(bigint, text) to authenticated;
grant execute on function public.mark_listing_fee_paid(text, text, numeric) to service_role;
grant execute on function public.remind_expiring_drafts() to service_role;
grant execute on function public.delete_expired_drafts() to service_role;

commit;

NOTIFY pgrst, 'reload schema';
