/**
 * Netlify Scheduled Function: gig-expiry-check
 * Runs every minute (see netlify.toml schedule below). Handles unmatched
 * gig_requests:
 *
 *   1. ~1 min unmatched (retry_count = 0) -> re-broadcast at a wider radius
 *   2. ~2 min unmatched (retry_count >= 1) -> auto-cancel, status becomes
 *      'no_drivers_available', customer notified (a paid fare is refunded:
 *      the refund is queued by migration 018's trigger)
 *   "Unmatched" is measured from searching_since (when the card payment
 *   arrived), falling back to created_at for older gigs.
 *   3. Card gigs never paid within the payment window -> cancelled
 *      (expire_unpaid_gigs, migration 018)
 *   4. If app_settings.gig_auto_refunds is on, send queued refunds
 *
 * NOTE on timing: this mirrors an original 30s/60s design intent, but
 * Netlify Scheduled Functions run on cron and practically can't go finer
 * than ~1 minute granularity — thresholds below are adapted to that
 * constraint, not the original numbers. Confirm your Netlify plan
 * comfortably supports minute-level invocations before relying on this
 * in production (not yet verified).
 *
 * Broadcasting is shared with payfast-webhook via lib/gigMatching.js.
 *
 * Schedule in netlify.toml:
 *   [[scheduled.functions]]
 *     name = "gig-expiry-check"
 *     schedule = "* * * * *"   # every minute
 *
 * Place at: netlify/functions/gig-expiry-check.js
 */
import { createClient } from '@supabase/supabase-js';
import { offerGigToDrivers, EXPANDED_RADIUS_METERS } from './lib/gigMatching.js';
import { sendGigRefund } from './lib/gigRefunds.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const RETRY_AFTER_MS = 60 * 1000;       // expand radius after ~1 min unmatched
const CANCEL_AFTER_MS = 2 * 60 * 1000;  // give up after ~2 min unmatched
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

export const handler = async () => {
  const now = new Date();
  const results = { rebroadcast: 0, cancelled: 0, unpaid_expired: 0, refunds_sent: 0, stale_drivers_cleared: 0, auto_confirmed: 0, errors: [] };

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
      .select('id, gig_type, customer_id, pickup_address, dropoff_address, fare_amount, status, payment_status, retry_count, search_radius_meters, created_at, searching_since')
      .eq('status', 'pending');

    if (error) throw error;

    for (const gig of gigs) {
      const elapsedMs = now - new Date(gig.searching_since || gig.created_at);

      if (gig.retry_count === 0 && elapsedMs >= RETRY_AFTER_MS) {
        const { notified } = await offerGigToDrivers(supabase, gig, EXPANDED_RADIUS_METERS, 'gig-expiry-check');

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
          `We couldn't find a driver for your ${gig.gig_type} request near ${gig.pickup_address}.`
            + (gig.payment_status === 'paid' ? ' Your payment will be refunded in full.' : ' Please try again.'),
          { gig_id: gig.id, action: 'retry_gig' },
        );

        console.log(`[gig-expiry-check] gig=${gig.id} cancelled — no drivers found after retry`);
        results.cancelled++;
      }
    }

    // Card gigs nobody paid for in time (migration 018)
    const { data: expired, error: expErr } = await supabase.rpc('expire_unpaid_gigs');
    if (expErr) {
      console.error('[gig-expiry-check] expire_unpaid_gigs failed:', expErr);
    } else {
      for (const e of expired || []) {
        results.unpaid_expired++;
        await notify(e.customer_id, 'gig_payment_expired', 'Request cancelled',
          'Your request was cancelled because the payment was not completed. You have not been charged.', { gig_id: e.gig_id });
      }
    }

    // Queued refunds, once automatic refunds are switched on in admin
    const { data: cfg } = await supabase.from('app_settings').select('gig_auto_refunds').eq('id', 1).maybeSingle();
    if (cfg?.gig_auto_refunds) {
      const { data: due, error: dueErr } = await supabase
        .from('gig_refunds').select('id').eq('status', 'due').order('id').limit(10);
      if (dueErr) console.error('[gig-expiry-check] loading due refunds failed:', dueErr);
      for (const r of due || []) {
        const out = await sendGigRefund(supabase, r.id, null);
        if (out.ok) results.refunds_sent++;
        else results.errors.push(`refund ${r.id}: ${out.error}`);
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