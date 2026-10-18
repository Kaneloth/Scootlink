/**
 * Netlify Function: create-gig-request
 * Creates a card-paid gig_requests row (ride or delivery) in status
 * 'awaiting_payment' with the quoted fare (migration 018). The app then shows
 * the fare on the gig's status page, where "Pay" calls gig-checkout for the
 * PayFast form. No driver is searched for until PayFast confirms the
 * payment: payfast-webhook then calls mark_gig_fare_paid() and offers the
 * gig to nearby drivers (lib/gigMatching.js).
 *
 *   1. Verify caller's JWT -> customer_id (never trust a client-supplied id)
 *   2. Cancel the customer's older unpaid requests (they never paid), then
 *      enforce one open request per customer
 *   3. Quote the fare (admin pricing, straight-line distance)
 *   4. Insert the gig (awaiting_payment) and return it
 *
 * Unpaid requests are cancelled by gig-expiry-check after
 * app_settings.gig_payment_window_minutes (default 30).
 * Cash gigs come later; payment_method 'cash' is refused for now.
 *
 * POST body: { gig_type, pickup_address, pickup_lat, pickup_lng,
 *              dropoff_address, dropoff_lat, dropoff_lng,
 *              delivery_notes?, recipient_name?, recipient_phone?,
 *              payment_method?: 'card' }
 * Header: Authorization: Bearer <customer's JWT>
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const DEFAULT_RADIUS_METERS = 5000; // first search radius (see lib/gigMatching.js)

// Used only if the app_settings read below fails — same rationale as
// the other functions' FALLBACK_* constants: never risk a null/zero
// fare because of a transient DB hiccup. These are also the values
// app_settings itself defaults to (see 003_gig_pricing_and_expiry.sql) —
// starting estimates, not researched/verified pricing.
const FALLBACK_RIDE_MIN_FARE = 30.00;
const FALLBACK_RIDE_PER_KM = 7.50;
const FALLBACK_DELIVERY_MIN_FARE = 25.00;
const FALLBACK_DELIVERY_PER_KM = 6.00;

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Straight-line distance in km — used only for the fare ESTIMATE at
// request time. Not the same as actual route distance the driver will
// travel; fine for an upfront quote, not for final billing precision.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: 'Invalid JSON' }; }

  const {
    gig_type,
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    delivery_notes,
    recipient_name,
    recipient_phone,
    payment_method = 'card',
  } = body;

  if (!['ride', 'delivery'].includes(gig_type)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "gig_type must be 'ride' or 'delivery'" }) };
  }
  if (!pickup_address || !dropoff_address || pickup_lat == null || pickup_lng == null) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing required location fields' }) };
  }
  // The fare is paid upfront, so it must be quotable: both points are needed.
  if (dropoff_lat == null || dropoff_lng == null) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Choose the drop-off address from the suggestions so we can quote the fare' }) };
  }
  if (payment_method !== 'card') {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Only card payment is available for now' }) };
  }

  // ── Verify JWT, derive customer_id server-side ────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Missing Authorization header' }) };
  }
  const jwt = authHeader.replace('Bearer ', '');

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    console.warn('[create-gig-request] Invalid or expired session:', userErr?.message);
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  const customerId = userData.user.id;

  // ── Older unpaid requests never went anywhere: cancel them ────────────────
  const { error: staleErr } = await supabase
    .from('gig_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'Replaced by a new request before payment', updated_at: new Date().toISOString() })
    .eq('customer_id', customerId)
    .eq('status', 'awaiting_payment');
  if (staleErr) {
    console.error('[create-gig-request] Clearing unpaid requests failed:', staleErr);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to create gig request' }) };
  }

  // ── One open request per customer ─────────────────────────────────────────
  const { data: openGig, error: openGigErr } = await supabase
    .from('gig_requests')
    .select('id')
    .eq('customer_id', customerId)
    .in('status', ['pending', 'accepted', 'in_progress'])
    .limit(1)
    .maybeSingle();
  if (openGigErr) {
    console.error('[create-gig-request] Open-gig check failed:', openGigErr);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to create gig request' }) };
  }
  if (openGig) {
    return {
      statusCode: 409,
      headers: HEADERS,
      body: JSON.stringify({ error: 'You already have an open gig request', open_gig_id: openGig.id }),
    };
  }

  // ── Compute fare estimate ──────────────────────────────────────────────────
  // Straight-line distance only (see haversineKm note above) — an upfront
  // estimate shown to the customer, not final billing.
  let fareAmount = null;
  {
    const distanceKm = haversineKm(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng);

    let minFare = gig_type === 'ride' ? FALLBACK_RIDE_MIN_FARE : FALLBACK_DELIVERY_MIN_FARE;
    let perKm = gig_type === 'ride' ? FALLBACK_RIDE_PER_KM : FALLBACK_DELIVERY_PER_KM;
    try {
      const { data: settings, error: settingsErr } = await supabase
        .from('app_settings')
        .select('ride_minimum_fare, ride_per_km_rate, delivery_minimum_fare, delivery_per_km_rate')
        .eq('id', 1)
        .single();
      if (settingsErr) throw settingsErr;
      if (gig_type === 'ride') {
        if (settings?.ride_minimum_fare != null) minFare = settings.ride_minimum_fare;
        if (settings?.ride_per_km_rate != null) perKm = settings.ride_per_km_rate;
      } else {
        if (settings?.delivery_minimum_fare != null) minFare = settings.delivery_minimum_fare;
        if (settings?.delivery_per_km_rate != null) perKm = settings.delivery_per_km_rate;
      }
    } catch (err) {
      console.warn('[create-gig-request] Could not read app_settings fare config, using fallback rates:', err.message);
    }

    // First 2km covered by the minimum fare, per the agreed pricing model
    const billableKm = Math.max(0, distanceKm - 2);
    fareAmount = Math.round((minFare + billableKm * perKm) * 100) / 100;
  }

  // ── Insert the gig request ────────────────────────────────────────────────
  const { data: gig, error: insertErr } = await supabase
    .from('gig_requests')
    .insert({
      gig_type,
      status: 'awaiting_payment',
      payment_method: 'card',
      payment_status: 'awaiting',
      customer_id: customerId,
      pickup_address,
      pickup_geo_location: `SRID=4326;POINT(${pickup_lng} ${pickup_lat})`,
      dropoff_address,
      dropoff_geo_location:
        `SRID=4326;POINT(${dropoff_lng} ${dropoff_lat})`,
      delivery_notes: delivery_notes || null,
      recipient_name: recipient_name || null,
      recipient_phone: recipient_phone || null,
      fare_amount: fareAmount,
      search_radius_meters: DEFAULT_RADIUS_METERS,
    })
    .select()
    .single();

  if (insertErr) {
    console.error('[create-gig-request] Insert failed:', insertErr);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to create gig request' }) };
  }

  console.log(`[create-gig-request] gig=${gig.id} type=${gig_type} customer=${customerId} fare=R${fareAmount} awaiting payment`);
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ gig }) };
};
