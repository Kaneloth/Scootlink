/**
 * Netlify Scheduled Function: vehicle-expiry-check
 * Runs once daily. Handles the full vehicle listing lifecycle:
 *
 *   1. Sends reminder notifications at 7, 3, and 1 days before expires_at
 *   2. Moves vehicles past expires_at into 'grace' state (2-day grace period)
 *   3. Moves vehicles past grace_expires_at into 'expired' state — HIDDEN
 *      from search but always remains visible to the owner under My Vehicles.
 *      Vehicles are never deleted; owners can re-list at any time.
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
  const results = { reminders_7d: 0, reminders_3d: 0, reminders_1d: 0, expired_hidden: 0, errors: [] };

  try {
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

    console.log('[vehicle-expiry-check] Run complete:', JSON.stringify(results));
    return { statusCode: 200, body: JSON.stringify(results) };
  } catch (err) {
    console.error('[vehicle-expiry-check] FATAL:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
