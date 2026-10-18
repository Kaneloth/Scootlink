/**
 * Netlify Scheduled Function: vehicle-expiry-check
 * Runs once daily. Handles the full vehicle listing lifecycle:
 *
 *   1. Sends reminder notifications at 7, 3, and 1 days before expires_at
 *   2. Moves vehicles past expires_at into 'grace' state (2-day grace period)
 *   3. Moves vehicles past grace_expires_at into 'expired' state — HIDDEN
 *      from search but always remains visible to the owner under My Vehicles.
 *      Listed vehicles are never deleted; owners can re-list at any time
 *      (relisting costs the listing fee — migration 021).
 *   4. Drafts (migration 021): a new vehicle that completed no step (listing
 *      paid/free, or roadworthy submitted) is reminded 2 days before its
 *      7-day deadline, then deleted with its photos if it has no history.
 *   0. Google Play refunds (migration 022): listing fees refunded or charged
 *      back in Google Play in the last 3 days lose their listing time. Runs
 *      first, so a listing that ends this way is hidden straight away.
 *
 * Schedule in netlify.toml:
 *   [[scheduled.functions]]
 *     name = "vehicle-expiry-check"
 *     schedule = "0 6 * * *"   # runs daily at 06:00 UTC
 *
 * Place at: netlify/functions/vehicle-expiry-check.js
 */
import { createClient } from '@supabase/supabase-js';
import { isPlayConfigured, listVoidedPurchases } from './lib/googlePlay.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const DAY_MS = 24 * 60 * 60 * 1000;

// "https://<project>.supabase.co/storage/v1/object/public/vehicle-images/<path>" -> "<path>"
function vehicleImagePath(url) {
  if (typeof url !== 'string') return null;
  const marker = '/object/public/vehicle-images/';
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}

async function notify(userId, type, title, body, data = null) {
  try {
    await supabase.rpc('create_notification', {
      p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
    });
  } catch (err) {
    console.error('[vehicle-expiry-check] notify failed:', err.message);
  }
}

// Google keeps voided purchases for 30 days; look back 3 so a missed run is covered
async function applyPlayRefunds(results) {
  if (!isPlayConfigured()) return;
  let voided;
  try {
    voided = await listVoidedPurchases(Date.now() - 3 * DAY_MS);
  } catch (err) {
    console.error('[vehicle-expiry-check] Google Play voided purchases failed:', err.message);
    results.errors.push('play_voided');
    return;
  }
  for (const v of voided) {
    const { data: rows, error } = await supabase.rpc('record_play_voided', { p_purchase_token: v.purchaseToken });
    if (error) {
      console.error(`[vehicle-expiry-check] record_play_voided failed order=${v.orderId}:`, error.message);
      results.errors.push('record_play_voided');
      continue;
    }
    const r = (rows && rows[0]) || {};
    if (r.action !== 'refunded') continue;
    results.play_refunds++;
    console.log(`[vehicle-expiry-check] Google Play refund order=${v.orderId} vehicle=${r.vehicle_id} listing_ended=${r.listing_ended}`);
    await notify(r.owner_id, 'listing_refunded', 'Listing payment refunded',
      r.listing_ended
        ? 'Your listing payment was refunded through Google Play, so the vehicle is no longer listed. You can relist it any time.'
        : 'Your listing payment was refunded through Google Play, so that period has been taken off your listing.',
      { vehicle_id: r.vehicle_id });
  }
}

export const handler = async () => {
  const now = new Date();
  const results = { reminders_7d: 0, reminders_3d: 0, reminders_1d: 0, expired_hidden: 0, draft_reminders: 0, drafts_deleted: 0, photos_removed: 0, play_refunds: 0, errors: [] };

  try {
    await applyPlayRefunds(results);

    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, owner_id, make, model, listing_state, expires_at, reminder_7d_sent, reminder_3d_sent, reminder_1d_sent')
      .eq('listing_state', 'active');

    if (error) throw error;

    for (const v of vehicles) {
      const vehicleLabel = `${v.make} ${v.model}`;
      const expiresAt = v.expires_at ? new Date(v.expires_at) : null;
      if (!expiresAt) continue;

      const daysLeft = Math.ceil((expiresAt - now) / DAY_MS);

      // ── Reminders (only while still 'active') ─────────────────────────────
      if (v.listing_state === 'active') {
        if (daysLeft <= 7 && daysLeft > 3 && !v.reminder_7d_sent) {
          await notify(
            v.owner_id, 'listing_expiry_7d',
            `Listing expires in 7 days`,
            `Your ${vehicleLabel} listing expires on ${expiresAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}. Re-list now to keep it visible to drivers.`,
            { vehicle_id: v.id, action: 'relist' }
          );
          await supabase.from('vehicles').update({ reminder_7d_sent: true }).eq('id', v.id);
          results.reminders_7d++;
        } else if (daysLeft <= 3 && daysLeft > 1 && !v.reminder_3d_sent) {
          await notify(
            v.owner_id, 'listing_expiry_3d',
            `Listing expires in 3 days`,
            `Your ${vehicleLabel} listing expires soon. Re-list now to avoid it being hidden from search.`,
            { vehicle_id: v.id, action: 'relist' }
          );
          await supabase.from('vehicles').update({ reminder_3d_sent: true }).eq('id', v.id);
          results.reminders_3d++;
        } else if (daysLeft <= 1 && daysLeft >= 0 && !v.reminder_1d_sent) {
          await notify(
            v.owner_id, 'listing_expiry_1d',
            `Listing expires tomorrow!`,
            `Your ${vehicleLabel} listing expires within 24 hours. Re-list it to keep it visible to drivers.`,
            { vehicle_id: v.id, action: 'relist' }
          );
          await supabase.from('vehicles').update({ reminder_1d_sent: true }).eq('id', v.id);
          results.reminders_1d++;
        }

        // ── Hide immediately on expiry — no grace period ───────────────────
        if (expiresAt <= now) {
          await supabase.from('vehicles').update({
            listing_state: 'expired',
          }).eq('id', v.id);

          await notify(
            v.owner_id, 'listing_hidden',
            `Listing hidden from search`,
            `Your ${vehicleLabel} listing has expired and is now hidden from search. Re-list it anytime from My Briefcase to make it visible again.`,
            { vehicle_id: v.id, action: 'relist' }
          );
          results.expired_hidden++;
        }
      }
    }

    // ── Drafts that never completed a step (migration 021) ────────────────────
    const { data: soon, error: soonErr } = await supabase.rpc('remind_expiring_drafts');
    if (soonErr) {
      console.error('[vehicle-expiry-check] remind_expiring_drafts failed:', soonErr);
      results.errors.push('remind_expiring_drafts');
    }
    for (const d of soon || []) {
      await notify(d.owner_id, 'draft_expiring', 'Finish listing your vehicle',
        `Your ${d.make} ${d.model} isn't listed yet and will be removed on ${new Date(d.draft_expires_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}. Pay the listing fee or submit the roadworthy certificate to keep it.`,
        { vehicle_id: d.vehicle_id });
      results.draft_reminders++;
    }

    const { data: deleted, error: delErr } = await supabase.rpc('delete_expired_drafts');
    if (delErr) {
      console.error('[vehicle-expiry-check] delete_expired_drafts failed:', delErr);
      results.errors.push('delete_expired_drafts');
    }
    for (const d of deleted || []) {
      results.drafts_deleted++;
      const paths = (Array.isArray(d.images) ? d.images : []).map(vehicleImagePath).filter(Boolean);
      if (paths.length) {
        const { error: rmErr } = await supabase.storage.from('vehicle-images').remove(paths);
        if (rmErr) console.error(`[vehicle-expiry-check] photo removal failed for draft ${d.vehicle_id}:`, rmErr);
        else results.photos_removed += paths.length;
      }
      await notify(d.owner_id, 'draft_removed', 'Unfinished vehicle removed',
        `Your ${d.make} ${d.model} was removed because it wasn't listed within 7 days. You can add it again any time.`, null);
    }

    console.log('[vehicle-expiry-check] Run complete:', JSON.stringify(results));
    return { statusCode: 200, body: JSON.stringify(results) };
  } catch (err) {
    console.error('[vehicle-expiry-check] FATAL:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
