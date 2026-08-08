/**
 * Netlify Function: create-gig-request
 * Creates a gig_requests row (ride or delivery) and broadcasts it to
 * nearby eligible drivers via Supabase Realtime — broadcast-to-all,
 * first driver to call accept_gig_request() (client-side RPC) wins.
 *
 * Matching pipeline:
 *   1. Verify caller's JWT -> customer_id (never trust a client-supplied id)
 *   2. Insert gig_requests row (status: 'pending')
 *   3. Call find_nearby_eligible_drivers() RPC (see 002_gigs_live_matching.sql)
 *      — filters by radius + driver_gig_verification tier
 *   4. Broadcast an offer to every returned driver at once via Realtime's
 *      REST broadcast endpoint (stateless — appropriate for a short-lived
 *      serverless function; avoids opening/tearing down a websocket per call)
 *
 * NOT yet implemented here (flagged, not forgotten):
 *   - fare_amount / pricing — no pricing model designed yet, left null
 *   - retry/expiry policy for gigs with 0 nearby drivers or a failed
 *     broadcast — currently just stays 'pending' with no follow-up
 *
 * POST body: { gig_type, pickup_address, pickup_lat, pickup_lng,
 *              dropoff_address, dropoff_lat, dropoff_lng,
 *              delivery_notes?, recipient_name?, recipient_phone? }
 * Header: Authorization: Bearer <customer's JWT>
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const DEFAULT_RADIUS_METERS = 5000; // placeholder — final radius not yet decided

// Used only if the app_settings read below fails — same rationale as
// grant-signup-credits.js's FALLBACK_* constants: never risk a null/zero
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
  } = body;

  if (!['ride', 'delivery'].includes(gig_type)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "gig_type must be 'ride' or 'delivery'" }) };
  }
  if (!pickup_address || !dropoff_address || pickup_lat == null || pickup_lng == null) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing required location fields' }) };
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

  // ── Compute fare estimate ──────────────────────────────────────────────────
  // Straight-line distance only (see haversineKm note above) — an upfront
  // estimate shown to the customer, not final billing.
  let fareAmount = null;
  if (dropoff_lat != null && dropoff_lng != null) {
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
      status: 'pending',
      customer_id: customerId,
      pickup_address,
      pickup_geo_location: `SRID=4326;POINT(${pickup_lng} ${pickup_lat})`,
      dropoff_address,
      dropoff_geo_location:
        dropoff_lat != null && dropoff_lng != null
          ? `SRID=4326;POINT(${dropoff_lng} ${dropoff_lat})`
          : null,
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

  // ── Find nearby eligible drivers ──────────────────────────────────────────
  const { data: nearbyDrivers, error: matchErr } = await supabase.rpc(
    'find_nearby_eligible_drivers',
    { p_gig_id: gig.id, p_radius_meters: DEFAULT_RADIUS_METERS },
  );

  if (matchErr) {
    console.error('[create-gig-request] Matching RPC failed for gig=' + gig.id + ':', matchErr);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ gig, driversNotified: 0, warning: 'Matching failed, will need manual retry' }),
    };
  }

  if (!nearbyDrivers || nearbyDrivers.length === 0) {
    console.log(`[create-gig-request] gig=${gig.id} — no eligible drivers within ${DEFAULT_RADIUS_METERS}m`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ gig, driversNotified: 0 }) };
  }

  // ── Broadcast to all eligible drivers at once ─────────────────────────────
  const messages = nearbyDrivers.map((d) => ({
    topic: `driver:${d.driver_id}:gig-offers`,
    event: 'gig_offer',
    private: true,
    payload: {
      gig_id: gig.id,
      gig_type: gig.gig_type,
      pickup_address: gig.pickup_address,
      dropoff_address: gig.dropoff_address,
      distance_meters: d.distance_meters,
    },
  }));

  try {
    const broadcastRes = await fetch(`${process.env.VITE_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ messages }),
    });
    if (!broadcastRes.ok) {
      const errText = await broadcastRes.text();
      console.error(`[create-gig-request] Broadcast failed for gig=${gig.id}:`, errText);
    }
  } catch (err) {
    console.error(`[create-gig-request] Broadcast threw for gig=${gig.id}:`, err);
  }

  console.log(`[create-gig-request] gig=${gig.id} type=${gig_type} customer=${customerId} notified ${nearbyDrivers.length} driver(s)`);
  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ gig, driversNotified: nearbyDrivers.length }),
  };
};