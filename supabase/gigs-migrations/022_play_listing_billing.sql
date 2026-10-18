-- ============================================================
-- Skootlink — Listing fee through Google Play Billing (Android app)
-- Branch: feature/ride-hailing
-- Depends on: 018 (platform_payments), 021 (listing periods)
--
-- Google Play requires its own billing for the listing fee inside the
-- Android app, so the app sells one consumable in-app product (one listing
-- period) instead of opening PayFast. The web keeps PayFast.
--
-- Flow (Netlify function play-listing):
--   1. start:  a platform_payments row (provider 'google_play', status
--      'initiated') — its m_payment_id goes to Google as the purchase's
--      obfuscated account id, which ties the purchase to this vehicle.
--   2. verify: the server reads the purchase from the Google Play Developer
--      API, then mark_listing_play_paid() activates or extends the listing,
--      then the server consumes the purchase (so it can be bought again, and
--      so Google doesn't refund it as unacknowledged after 3 days).
--   3. A refund/chargeback in Google Play (voided purchase) is picked up by
--      the daily vehicle-expiry-check: record_play_voided() takes the time
--      back off the listing.
-- Google sets the price (Play Console), not app_settings.listing_fee; the
-- amount stored is the configured fee, for reporting.
--
-- New columns are added WITHOUT "if not exists" on purpose (stop, don't reuse).
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================
begin;

-- ── 1. platform_payments: Google Play purchase details ─────────────────────────
alter table public.platform_payments
  add column play_purchase_token text unique,
  add column play_order_id text,
  add column play_test_purchase boolean not null default false,
  add column refunded_at timestamp with time zone;

alter table public.platform_payments drop constraint if exists platform_payments_status_check;
alter table public.platform_payments
  add constraint platform_payments_status_check
  check (status in ('initiated', 'paid', 'cancelled', 'refunded'));

-- ── 2. listing_periods: a period taken back by a refund ────────────────────────
alter table public.listing_periods
  add column voided_at timestamp with time zone;

-- ── 3. A verified Google Play purchase (service role only) ─────────────────────
-- activated | duplicate (this purchase was already used) | vehicle_missing
-- (deleted meanwhile: refund in Play Console) | not_rental (purpose changed
-- to gigs meanwhile: refund) | unknown (no such payment for this user)
create or replace function public.mark_listing_play_paid(
  p_m_payment_id text,
  p_user_id uuid,
  p_purchase_token text,
  p_order_id text,
  p_test boolean
)
returns table (vehicle_id bigint, owner_id uuid, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.platform_payments;
  v_used public.platform_payments;
begin
  -- the same purchase sent twice (app retry, recovery after a crash)
  select * into v_used from public.platform_payments where play_purchase_token = p_purchase_token;
  if found then
    return query select v_used.vehicle_id, v_used.user_id, 'duplicate'::text;
    return;
  end if;

  select * into v_pay from public.platform_payments
  where m_payment_id = p_m_payment_id and kind = 'listing_fee' and provider = 'google_play'
    and user_id = p_user_id
  for update;
  if not found then
    return query select null::bigint, null::uuid, 'unknown'::text;
    return;
  end if;
  if v_pay.status = 'paid' then
    -- this reference was already paid with a different purchase
    return query select v_pay.vehicle_id, v_pay.user_id, 'duplicate'::text;
    return;
  end if;

  update public.platform_payments
  set status = 'paid', play_purchase_token = p_purchase_token, play_order_id = p_order_id,
      play_test_purchase = coalesce(p_test, false), paid_at = now()
  where id = v_pay.id;

  if not exists (select 1 from public.vehicles v where v.id = v_pay.vehicle_id and v.owner_id = v_pay.user_id) then
    return query select v_pay.vehicle_id, v_pay.user_id, 'vehicle_missing'::text;
    return;
  end if;
  if not exists (select 1 from public.vehicles v where v.id = v_pay.vehicle_id and v.listing_purpose in ('rental', 'both')) then
    return query select v_pay.vehicle_id, v_pay.user_id, 'not_rental'::text;
    return;
  end if;

  perform public._activate_listing(v_pay.vehicle_id, v_pay.id, false);
  return query select v_pay.vehicle_id, v_pay.user_id, 'activated'::text;
end;
$$;

-- ── 4. A Google Play refund / chargeback (service role only) ───────────────────
-- refunded (listing time taken back) | duplicate | unknown (not one of ours)
create or replace function public.record_play_voided(p_purchase_token text)
returns table (vehicle_id bigint, owner_id uuid, action text, listing_ended boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.platform_payments;
  v_period public.listing_periods;
  v_vehicle public.vehicles;
  v_new_end timestamp with time zone;
begin
  select * into v_pay from public.platform_payments
  where play_purchase_token = p_purchase_token
  for update;
  if not found then
    return query select null::bigint, null::uuid, 'unknown'::text, false;
    return;
  end if;
  if v_pay.status = 'refunded' then
    return query select v_pay.vehicle_id, v_pay.user_id, 'duplicate'::text, false;
    return;
  end if;

  update public.platform_payments set status = 'refunded', refunded_at = now() where id = v_pay.id;

  select * into v_period from public.listing_periods where payment_id = v_pay.id and voided_at is null for update;
  if not found then
    -- paid but never activated (vehicle removed meanwhile)
    return query select v_pay.vehicle_id, v_pay.user_id, 'refunded'::text, false;
    return;
  end if;
  update public.listing_periods set voided_at = now() where id = v_period.id;

  select * into v_vehicle from public.vehicles where id = v_period.vehicle_id for update;
  if not found or v_vehicle.listing_state <> 'active' or v_vehicle.expires_at is null then
    return query select v_pay.vehicle_id, v_pay.user_id, 'refunded'::text, false;
    return;
  end if;

  -- take the refunded period's length off the end of the listing
  v_new_end := v_vehicle.expires_at - (v_period.ends_at - v_period.starts_at);
  if v_new_end <= now() then
    update public.vehicles
    set listing_state = 'expired', expires_at = now(), grace_expires_at = null
    where id = v_vehicle.id;
    return query select v_pay.vehicle_id, v_pay.user_id, 'refunded'::text, true;
  else
    update public.vehicles
    set expires_at = v_new_end, reminder_7d_sent = false, reminder_3d_sent = false, reminder_1d_sent = false
    where id = v_vehicle.id;
    return query select v_pay.vehicle_id, v_pay.user_id, 'refunded'::text, false;
  end if;
end;
$$;

revoke execute on function public.mark_listing_play_paid(text, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.record_play_voided(text) from public, anon, authenticated;
grant execute on function public.mark_listing_play_paid(text, uuid, text, text, boolean) to service_role;
grant execute on function public.record_play_voided(text) to service_role;

commit;

NOTIFY pgrst, 'reload schema';
