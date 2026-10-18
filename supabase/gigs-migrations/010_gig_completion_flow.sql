-- ============================================================
-- Skootlink — Gigs feature: completion flow, disputes, earnings, ratings
-- Branch: feature/ride-hailing
-- Depends on: 001, 003, 009
--
-- Flow (decided in planning; commission decided 2026-10-17):
--   1. Driver taps End Trip      -> gig_end_trip(): driver_completed_at set,
--                                   status stays 'in_progress' until the
--                                   customer answers.
--   2a. Customer confirms        -> confirm_gig_completion(): 'completed'.
--   2b. Customer reports issue   -> report_gig_issue(): 'disputed', and a row
--                                   in user_reports so it appears in the
--                                   existing admin Dispute Center.
--   2c. No answer in 24 hours    -> auto_confirm_stale_gigs() (called by the
--                                   gig-expiry-check scheduled function):
--                                   'completed' with auto_confirmed = true.
--   On completion: commission (app_settings.gig_commission_percent, default
--   15%, admin-editable) and driver payout are recorded on the gig, and a
--   gig_earnings_ledger row is added with status 'pending' — earned but NOT
--   withdrawable, because customer payments are not collected yet.
--   3. Both sides may rate each other once -> submit_gig_review(), which
--      updates profiles.rating / total_reviews exactly like submit_review.
--      (reviews.target_type is widened to allow 'customer' — step 0.)
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

-- 0. Reviews: allow 'customer' as a review target.
--    The live table only allowed target_type 'owner' or 'driver'
--    (CHECK ((target_type = ANY (ARRAY['owner','driver'])))), so a driver
--    rating a customer would fail. Widened to owner/driver/customer; every
--    existing row still satisfies it. The old constraint is found by what it
--    checks rather than by name, since its name isn't known.
do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'reviews' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%target_type%'
  loop
    execute format('alter table public.reviews drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.reviews
  add constraint reviews_target_type_check
  check (target_type in ('owner', 'driver', 'customer'));

-- 1. Settings and columns ----------------------------------------------------
alter table public.app_settings
  add column if not exists gig_commission_percent numeric not null default 15
    check (gig_commission_percent >= 0 and gig_commission_percent <= 100);

comment on column public.app_settings.gig_commission_percent is
  'Skootlink commission on each completed gig, as a percentage of the fare. Admin-editable (Gig Settings).';

alter table public.gig_requests add column if not exists completed_at timestamp with time zone;
alter table public.gig_requests add column if not exists disputed_at timestamp with time zone;

alter table public.reviews add column if not exists gig_id bigint references public.gig_requests(id);
create unique index if not exists reviews_one_per_gig_reviewer
  on public.reviews (gig_id, reviewer_id) where gig_id is not null;

alter table public.user_reports add column if not exists gig_id bigint references public.gig_requests(id);

-- 2. Internal: finish a gig and record the money -------------------------------
--    Not callable by app users (execute revoked below); used by the
--    confirm and auto-confirm functions only.
create or replace function public._gig_finalize(p_gig_id bigint, p_auto boolean)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
  v_percent numeric;
  v_commission numeric;
  v_payout numeric;
begin
  select coalesce(gig_commission_percent, 15) into v_percent from public.app_settings where id = 1;
  v_percent := coalesce(v_percent, 15);

  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found or v_gig.status <> 'in_progress' or v_gig.driver_completed_at is null then
    raise exception 'This gig is not waiting for confirmation';
  end if;

  v_commission := round(coalesce(v_gig.fare_amount, 0) * v_percent / 100, 2);
  v_payout := coalesce(v_gig.fare_amount, 0) - v_commission;

  update public.gig_requests
  set status = 'completed',
      completed_at = now(),
      customer_confirmed_at = case when p_auto then null else now() end,
      auto_confirmed = p_auto,
      commission_amount = v_commission,
      driver_payout_amount = v_payout,
      updated_at = now()
  where id = p_gig_id
  returning * into v_gig;

  insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status)
  values (v_gig.driver_id, v_gig.id, v_payout, 'pending')
  on conflict (gig_request_id) do nothing;

  return v_gig;
end;
$$;

revoke execute on function public._gig_finalize(bigint, boolean) from public, anon, authenticated;

-- 3. Driver: End Trip -------------------------------------------------------------
create or replace function public.gig_end_trip(p_gig_id bigint)
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
  set driver_completed_at = now(),
      updated_at = now()
  where id = p_gig_id
    and driver_id = auth.uid()
    and status = 'in_progress'
    and driver_completed_at is null
  returning * into v_gig;

  if not found then
    raise exception 'This trip cannot be ended';
  end if;

  return v_gig;
end;
$$;

-- 4. Customer: confirm complete -----------------------------------------------------
create or replace function public.confirm_gig_completion(p_gig_id bigint)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.gig_requests where id = p_gig_id and customer_id = auth.uid()
  ) then
    raise exception 'Gig not found';
  end if;

  return public._gig_finalize(p_gig_id, false);
end;
$$;

-- 5. Customer: report an issue (holds the gig for admin review) ----------------------
create or replace function public.report_gig_issue(p_gig_id bigint, p_reason text)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gig public.gig_requests;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 1000), '');
  v_driver_name text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_reason is null then
    raise exception 'Please describe the issue';
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found or v_gig.customer_id <> v_uid then
    raise exception 'Gig not found';
  end if;
  if v_gig.status <> 'in_progress' then
    raise exception 'Issues can only be reported before the gig is confirmed';
  end if;

  update public.gig_requests
  set status = 'disputed',
      dispute_reason = v_reason,
      disputed_at = now(),
      updated_at = now()
  where id = p_gig_id
  returning * into v_gig;

  select full_name into v_driver_name from public.profiles where id = v_gig.driver_id;

  insert into public.user_reports (reporter_id, reported_id, reported_name, reason, details, gig_id)
  values (
    v_uid,
    v_gig.driver_id,
    coalesce(v_driver_name, 'Driver'),
    v_reason,
    format('Gig #%s (%s): %s', v_gig.id, v_gig.gig_type, v_reason),
    v_gig.id
  );

  return v_gig;
end;
$$;

-- 6. Auto-confirm after 24 hours (service role only; scheduled function) --------------
create or replace function public.auto_confirm_stale_gigs()
returns table (gig_id bigint, customer_id uuid, driver_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_gig public.gig_requests;
begin
  for v_id in
    select g.id from public.gig_requests g
    where g.status = 'in_progress'
      and g.driver_completed_at is not null
      and g.driver_completed_at < now() - interval '24 hours'
  loop
    begin
      v_gig := public._gig_finalize(v_id, true);
      gig_id := v_gig.id;
      customer_id := v_gig.customer_id;
      driver_id := v_gig.driver_id;
      return next;
    exception when others then
      raise warning 'auto_confirm_stale_gigs: gig % skipped: %', v_id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke execute on function public.auto_confirm_stale_gigs() from public, anon, authenticated;
grant execute on function public.auto_confirm_stale_gigs() to service_role;

-- 7. Ratings: one review per person per completed gig ----------------------------------
create or replace function public.submit_gig_review(
  p_gig_id bigint,
  p_rating integer,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer uuid := auth.uid();
  v_gig public.gig_requests;
  v_target uuid;
  v_target_type text;
  v_avg numeric;
  v_count integer;
begin
  if v_reviewer is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id;
  if not found or v_reviewer not in (v_gig.customer_id, v_gig.driver_id) then
    raise exception 'Gig not found';
  end if;
  if v_gig.status <> 'completed' then
    raise exception 'You can rate a gig once it is completed';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  if v_reviewer = v_gig.customer_id then
    v_target := v_gig.driver_id;
    v_target_type := 'driver';
  else
    v_target := v_gig.customer_id;
    v_target_type := 'customer';
  end if;

  if exists (select 1 from public.reviews where gig_id = p_gig_id and reviewer_id = v_reviewer) then
    raise exception 'You have already rated this gig';
  end if;

  insert into public.reviews (gig_id, reviewer_id, target_id, target_type, rating, comment)
  values (p_gig_id, v_reviewer, v_target, v_target_type, p_rating,
          nullif(left(trim(coalesce(p_comment, '')), 1000), ''));

  -- Same recalculation as submit_review (rentals), so one rating covers both.
  select avg(rating), count(*) into v_avg, v_count
  from public.reviews where target_id = v_target;

  update public.profiles set rating = v_avg, total_reviews = v_count where id = v_target;
end;
$$;

-- Has the signed-in user already rated this gig? (reviews RLS is unknown,
-- so the app asks this instead of reading reviews directly.)
create or replace function public.my_gig_review_exists(p_gig_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.reviews where gig_id = p_gig_id and reviewer_id = auth.uid());
$$;

revoke execute on function public.gig_end_trip(bigint) from public, anon;
revoke execute on function public.confirm_gig_completion(bigint) from public, anon;
revoke execute on function public.report_gig_issue(bigint, text) from public, anon;
revoke execute on function public.submit_gig_review(bigint, integer, text) from public, anon;
revoke execute on function public.my_gig_review_exists(bigint) from public, anon;
grant execute on function public.gig_end_trip(bigint) to authenticated;
grant execute on function public.confirm_gig_completion(bigint) to authenticated;
grant execute on function public.report_gig_issue(bigint, text) to authenticated;
grant execute on function public.submit_gig_review(bigint, integer, text) to authenticated;
grant execute on function public.my_gig_review_exists(bigint) to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
