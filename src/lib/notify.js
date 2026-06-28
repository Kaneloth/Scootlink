/**
 * notify.js — helper to insert in-app notifications via Supabase RPC.
 * Place at: src/lib/notify.js
 *
 * Uses the create_notification RPC (security definer) so it works from
 * the frontend without needing the service role key.
 */
import { supabase } from '@/api/supabaseClient';

/**
 * @param {string} userId   — recipient's user id
 * @param {string} type     — notification type key
 * @param {string} title    — short heading
 * @param {string} body     — longer description
 * @param {object} [data]   — optional JSON payload (rental_id etc.)
 */
export async function notify(userId, type, title, body, data = null) {
  if (!userId) return;
  try {
    await supabase.rpc('create_notification', {
      p_user_id: userId,
      p_type:    type,
      p_title:   title,
      p_body:    body,
      p_data:    data ? data : null,
    });
  } catch (err) {
    // Non-fatal — notification failure must never block the main flow
    console.warn('[notify] failed:', err?.message);
  }
}
