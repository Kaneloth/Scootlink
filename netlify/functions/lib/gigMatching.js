/**
 * gigMatching — offer a gig to nearby eligible drivers.
 * Place at: netlify/functions/lib/gigMatching.js
 *
 * Shared by create-gig-request (cash gigs, later), payfast-webhook (card gigs,
 * once paid) and gig-expiry-check (the wider-radius retry). Previously the
 * same code lived in two of those files.
 *
 *   1. find_nearby_eligible_drivers() (radius + verification tier + vehicle)
 *   2. Realtime broadcast to each driver's private channel (app open)
 *   3. gig_offers rows + a notification per newly offered driver; the
 *      notifications webhook turns that into a phone push (app closed)
 */

export const DEFAULT_RADIUS_METERS = 5000;
export const EXPANDED_RADIUS_METERS = 7000;

// Records who was offered this gig (migration 013) and notifies each NEWLY
// offered driver. Drivers already offered (e.g. at 5 km, before the 7 km
// retry) are skipped so nobody gets the same offer twice.
async function recordOffersAndNotify(supabase, gig, drivers, logTag) {
  const rows = drivers.map((d) => ({
    gig_id: gig.id,
    driver_id: d.driver_id,
    distance_meters: d.distance_meters,
  }));
  const { data: inserted, error } = await supabase
    .from('gig_offers')
    .upsert(rows, { onConflict: 'gig_id,driver_id', ignoreDuplicates: true })
    .select('driver_id, distance_meters');
  if (error) {
    console.error(`[${logTag}] Recording offers failed for gig=${gig.id}:`, error);
    return 0;
  }

  const title = gig.gig_type === 'ride' ? 'New ride request nearby' : 'New delivery request nearby';
  const fare = gig.fare_amount != null ? ` · R${Number(gig.fare_amount).toFixed(2)}` : '';
  const results = await Promise.allSettled((inserted || []).map((d) =>
    supabase.rpc('create_notification', {
      p_user_id: d.driver_id,
      p_type: 'gig_offer',
      p_title: title,
      p_body: `Pickup: ${gig.pickup_address}${fare} · ${(Number(d.distance_meters || 0) / 1000).toFixed(1)} km away`,
      p_data: { gig_id: gig.id },
    }).then(({ error: nErr }) => { if (nErr) throw nErr; }),
  ));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.error(`[${logTag}] ${failed.length} offer notification(s) failed for gig=${gig.id}:`, failed[0].reason);
  }
  return results.length - failed.length;
}

/**
 * Offers `gig` to eligible drivers within `radiusMeters`.
 * `gig` needs: id, gig_type, pickup_address, dropoff_address, fare_amount.
 * Returns { notified, pushed, error } — never throws.
 */
export async function offerGigToDrivers(supabase, gig, radiusMeters, logTag) {
  const { data: nearbyDrivers, error: matchErr } = await supabase.rpc(
    'find_nearby_eligible_drivers',
    { p_gig_id: gig.id, p_radius_meters: radiusMeters },
  );
  if (matchErr) {
    console.error(`[${logTag}] Matching RPC failed for gig=${gig.id}:`, matchErr);
    return { notified: 0, pushed: 0, error: matchErr.message };
  }
  if (!nearbyDrivers || nearbyDrivers.length === 0) {
    return { notified: 0, pushed: 0, error: null };
  }

  const messages = nearbyDrivers.map((d) => ({
    topic: `driver:${d.driver_id}:gig-offers`,
    event: 'gig_offer',
    private: true,
    payload: {
      gig_id: gig.id,
      gig_type: gig.gig_type,
      pickup_address: gig.pickup_address,
      dropoff_address: gig.dropoff_address,
      fare_amount: gig.fare_amount,
      distance_meters: d.distance_meters,
    },
  }));

  try {
    const res = await fetch(`${process.env.VITE_SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) console.error(`[${logTag}] Broadcast failed for gig=${gig.id}:`, await res.text());
  } catch (err) {
    console.error(`[${logTag}] Broadcast threw for gig=${gig.id}:`, err);
  }

  // Push notifications go out even if the live broadcast failed
  const pushed = await recordOffersAndNotify(supabase, gig, nearbyDrivers, logTag);
  return { notified: nearbyDrivers.length, pushed, error: null };
}
