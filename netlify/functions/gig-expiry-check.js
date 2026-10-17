/**
 * Netlify Scheduled Function: gig-expiry-check
 * Runs every minute (see netlify.toml schedule below). Handles unmatched
 * gig_requests:
 *
 *   1. ~1 min unmatched (retry_count = 0) -> re-broadcast at a wider radius
 *   2. ~2 min unmatched (retry_count >= 1) -> auto-cancel, status becomes
 *      'no_drivers_available', customer notified
 *
 * NOTE on timing: this mirrors an original 30s/60s design intent, but
 * Netlify Scheduled Functions run on cron and practically can't go finer
 * than ~1 minute granularity — thresholds below are adapted to that
 * constraint, not the original numbers. Confirm your Netlify plan
 * comfortably supports minute-level invocations before relying on this
 * in production (not yet verified).
 *
 * Duplicates the broadcast logic from create-gig-request.js — same
 * REST-broadcast approach, kept inline rather than shared since there's
 * no established shared-lib convention in netlify/functions yet. Worth
 * extracting to a shared helper if a third caller ever needs it.
 *
 * Schedule in netlify.toml:
 *   [[scheduled.functions]]
 *     name = "gig-expiry-check"
 *     schedule = "* * * * *"   # every minute
 *
 * Place at: netlify/functions/gig-expiry-check.js
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const RETRY_AFTER_MS = 60 * 1000;       // expand radius after ~1 min unmatched
const CANCEL_AFTER_MS = 2 * 60 * 1000;  // give up after ~2 min unmatched
const EXPANDED_RADIUS_METERS = 7000;    // matches the 5km -> 7km precedent from planning notes
const STALE_DRIVER_MS = 2 * 60 * 1000;     // drivers silent this long are flipped to unavailable

async function notify(userId, type, title, body, data = null) {
  try {
    await supabase.rpc('create_notification', {
      p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
    });
  } catch (err) {
    console.error('[gig-expiry-check] notify failed:', err.message);
  }
}

// Records who was offered this gig (migration 013) and sends each NEWLY
// offered driver an in-app notification. The notifications-table webhook
// turns that into a phone push (send-push-notification), so drivers whose
// app is closed still hear about the gig; tapping it opens /gig-offer/:id.
// Drivers already offered (e.g. at 5 km, before the 7 km re-broadcast) are
// skipped so nobody gets the same offer twice.
async function recordOffersAndNotify(gig, drivers, logTag) {
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

async function broadcastToDrivers(gig, radiusMeters) {
  const { data: nearbyDrivers, error: matchErr } = await supabase.rpc(
    'find_nearby_eligible_drivers',
    { p_gig_id: gig.id, p_radius_meters: radiusMeters },
  );

  if (matchErr) {
    console.error(`[gig-expiry-check] Matching RPC failed for gig=${gig.id}:`, matchErr);
    return 0;
  }
  if (!nearbyDrivers || nearbyDrivers.length === 0) {
    return 0;
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
    if (!res.ok) {
      console.error(`[gig-expiry-check] Broadcast failed for gig=${gig.id}:`, await res.text());
      return 0;
    }
  } catch (err) {
    console.error(`[gig-expiry-check] Broadcast threw for gig=${gig.id}:`, err);
    return 0;
  }

  await recordOffersAndNotify(gig, nearbyDrivers, 'gig-expiry-check');
  return nearbyDrivers.length;
}

export const handler = async () => {
  const now = new Date();
  const results = { rebroadcast: 0, cancelled: 0, stale_drivers_cleared: 0, auto_confirmed: 0, errors: [] };

  try {
    // Backstop cleanup: a driver whose app closed or lost signal stops sending
    // locations but would otherwise stay is_available = true. (Matching already
    // ignores locations older than 2 min — see migration 006 — this just keeps
    // the table honest.)
    const staleCutoff = new Date(now.getTime() - STALE_DRIVER_MS).toISOString();
    const { data: staleDrivers, error: staleErr } = await supabase
      .from('driver_live_locations')
      .update({ is_available: false })
      .eq('is_available', true)
      .lt('updated_at', staleCutoff)
      .select('driver_id');
    if (staleErr) {
      console.error('[gig-expiry-check] Stale driver cleanup failed:', staleErr);
    } else {
      results.stale_drivers_cleared = staleDrivers?.length || 0;
    }

    const { data: gigs, error } = await supabase
      .from('gig_requests')
      .select('id, gig_type, customer_id, pickup_address, dropoff_address, fare_amount, status, retry_count, search_radius_meters, created_at')
      .eq('status', 'pending');

    if (error) throw error;

    for (const gig of gigs) {
      const elapsedMs = now - new Date(gig.created_at);

      if (gig.retry_count === 0 && elapsedMs >= RETRY_AFTER_MS) {
        const notified = await broadcastToDrivers(gig, EXPANDED_RADIUS_METERS);

        const { error: updateErr } = await supabase
          .from('gig_requests')
          .update({ retry_count: 1, search_radius_meters: EXPANDED_RADIUS_METERS, updated_at: now.toISOString() })
          .eq('id', gig.id)
          .eq('status', 'pending'); // a driver may have accepted since the select

        if (updateErr) {
          console.error(`[gig-expiry-check] Failed to update retry_count for gig=${gig.id}:`, updateErr);
          results.errors.push(gig.id);
          continue;
        }

        console.log(`[gig-expiry-check] gig=${gig.id} re-broadcast at ${EXPANDED_RADIUS_METERS}m, notified ${notified} driver(s)`);
        results.rebroadcast++;
      } else if (gig.retry_count >= 1 && elapsedMs >= CANCEL_AFTER_MS) {
        // Only if still pending: never overwrite a gig a driver accepted
        // between the select above and this update.
        const { data: cancelledRows, error: cancelErr } = await supabase
          .from('gig_requests')
          .update({ status: 'no_drivers_available', updated_at: now.toISOString() })
          .eq('id', gig.id)
          .eq('status', 'pending')
          .select('id');

        if (cancelErr) {
          console.error(`[gig-expiry-check] Failed to cancel gig=${gig.id}:`, cancelErr);
          results.errors.push(gig.id);
          continue;
        }
        if (!cancelledRows || cancelledRows.length === 0) continue; // accepted meanwhile

        await notify(
          gig.customer_id, 'gig_no_drivers',
          'No drivers available',
          `We couldn't find a driver for your ${gig.gig_type} request near ${gig.pickup_address}. Please try again.`,
          { gig_id: gig.id, action: 'retry_gig' },
        );

        console.log(`[gig-expiry-check] gig=${gig.id} cancelled — no drivers found after retry`);
        results.cancelled++;
      }
    }

    // Completion: driver ended the trip 24h+ ago and the customer never
    // answered -> confirm automatically (migration 010).
    const { data: autoConfirmed, error: autoErr } = await supabase.rpc('auto_confirm_stale_gigs');
    if (autoErr) {
      console.error('[gig-expiry-check] auto_confirm_stale_gigs failed:', autoErr);
    } else {
      for (const g of autoConfirmed || []) {
        results.auto_confirmed++;
        await notify(g.customer_id, 'gig_completed', 'Gig completed',
          'Your gig was confirmed automatically after 24 hours. You can still rate your driver.', { gig_id: g.gig_id });
        await notify(g.driver_id, 'gig_completed', 'Gig completed',
          'The customer did not respond within 24 hours, so your gig was confirmed automatically.', { gig_id: g.gig_id });
      }
    }

    console.log('[gig-expiry-check] Run complete:', JSON.stringify(results));
    return { statusCode: 200, body: JSON.stringify(results) };
  } catch (err) {
    console.error('[gig-expiry-check] FATAL:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};