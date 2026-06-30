/**
 * Netlify Scheduled Function: vehicle-expiry-check
 * Runs once daily. Handles the full vehicle listing lifecycle:
 *
 *   1. Sends reminder notifications at 7, 3, and 1 days before expires_at
 *   2. Moves vehicles past expires_at into 'grace' state (2-day grace period)
 *   3. Moves vehicles past grace_expires_at into 'expired' state
 *   4. Removes expired vehicles from search — UNLESS they are currently
 *      part of an active rental, in which case removal is deferred until
 *      the rental ends (handled by a trigger / Dashboard.jsx on rental end)
 *
 * Schedule in netlify.toml:
 *   [[scheduled.functions]]
 *     name = "vehicle-expiry-check"
 *     schedule = "0 6 * * *"   # runs daily at 06:00 UTC
 *
 * Place at: netlify/functions/vehicle-expiry-check.js
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const DAY_MS = 24 * 60 * 60 * 1000;

async function notify(userId, type, title, body, data = null) {
  try {
    await supabase.rpc('create_notification', {
      p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
    });
  } catch (err) {
    console.error('[vehicle-expiry-check] notify failed:', err.message);
  }
}

export const handler = async () => {
  const now = new Date();
  const results = { reminders_7d: 0, reminders_3d: 0, reminders_1d: 0, moved_to_grace: 0, expired: 0, removed: 0, errors: [] };

  try {
    // ── 1. Fetch all active vehicles with their expiry info ─────────────────
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, owner_id, make, model, status, listing_state, expires_at, grace_expires_at, reminder_7d_sent, reminder_3d_sent, reminder_1d_sent')
      .in('listing_state', ['active', 'grace']);

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
            `Your ${vehicleLabel} listing expires soon. Re-list now to avoid it being removed from search.`,
            { vehicle_id: v.id, action: 'relist' }
          );
          await supabase.from('vehicles').update({ reminder_3d_sent: true }).eq('id', v.id);
          results.reminders_3d++;
        } else if (daysLeft <= 1 && daysLeft >= 0 && !v.reminder_1d_sent) {
          await notify(
            v.owner_id, 'listing_expiry_1d',
            `Listing expires tomorrow!`,
            `Your ${vehicleLabel} listing expires within 24 hours. Re-list now — after expiry you'll have a 2-day grace period before it's removed.`,
            { vehicle_id: v.id, action: 'relist' }
          );
          await supabase.from('vehicles').update({ reminder_1d_sent: true }).eq('id', v.id);
          results.reminders_1d++;
        }

        // ── Move into grace period once past expiry ────────────────────────
        if (expiresAt <= now) {
          const graceExpiresAt = new Date(expiresAt.getTime() + 2 * DAY_MS);
          await supabase.from('vehicles').update({
            listing_state: 'grace',
            grace_expires_at: graceExpiresAt.toISOString(),
          }).eq('id', v.id);

          await notify(
            v.owner_id, 'listing_expired',
            `Listing expired — 2 days left to renew`,
            `Your ${vehicleLabel} listing has expired and is hidden from search. You have until ${graceExpiresAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} to re-list it before it's permanently removed.`,
            { vehicle_id: v.id, action: 'relist' }
          );
          results.moved_to_grace++;
        }
      }

      // ── Move from grace into expired/removed ───────────────────────────────
      if (v.listing_state === 'grace' && v.grace_expires_at) {
        const graceExpiresAt = new Date(v.grace_expires_at);
        if (graceExpiresAt <= now) {
          // Check if vehicle is currently part of an active rental —
          // if so, defer removal until the rental ends.
          const { data: activeRental } = await supabase
            .from('rentals')
            .select('id')
            .eq('vehicle_id', v.id)
            .eq('status', 'active')
            .maybeSingle();

          if (activeRental) {
            // Mark as expired but don't remove yet — Dashboard.jsx removes it
            // when the rental is ended (status becomes 'completed'/'ended')
            await supabase.from('vehicles').update({ listing_state: 'expired' }).eq('id', v.id);
            results.expired++;
          } else {
            // No active rental — remove immediately
            await supabase.from('vehicles').update({
              listing_state: 'removed',
              status: 'removed',
            }).eq('id', v.id);

            await notify(
              v.owner_id, 'listing_removed',
              `Listing removed`,
              `Your ${vehicleLabel} listing has been removed from Skootlink after the renewal grace period expired. You can list it again from My Briefcase.`,
              { vehicle_id: v.id }
            );
            results.removed++;
          }
        }
      }
    }

    console.log('[vehicle-expiry-check] Run complete:', JSON.stringify(results));
    return { statusCode: 200, body: JSON.stringify(results) };
  } catch (err) {
    console.error('[vehicle-expiry-check] FATAL:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
