/**
 * Netlify Function: admin-run-proximity-scan
 * Admin-only bridge to run_proximity_alerts_scan() (locked to service_role
 * in the DB, so the browser can never call it directly) and to read/toggle
 * proximity_alert_settings.is_active for the automatic daily schedule.
 *
 * POST body: { action: 'run_scan' | 'get_status' | 'toggle', is_active?: boolean }
 * Auth: Bearer token, verified to belong to an admin (user_metadata.is_admin === true)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing authorization token' }) };
  }

  // Verify the caller is a genuine, currently-valid admin — never trust a
  // client-supplied flag, always re-check server-side against the token.
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || user.user_metadata?.is_admin !== true) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { action, is_active } = body;

  try {
    if (action === 'run_scan') {
      const { data, error } = await supabaseAdmin.rpc('run_proximity_alerts_scan');
      if (error) throw error;
      const result = data?.[0] || { drivers_alerted: 0, owners_alerted: 0 };
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    if (action === 'get_status') {
      const { data, error } = await supabaseAdmin
        .from('proximity_alert_settings')
        .select('is_active, updated_at')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    if (action === 'toggle') {
      if (typeof is_active !== 'boolean') {
        return { statusCode: 400, body: JSON.stringify({ error: 'is_active must be true or false' }) };
      }
      const { error } = await supabaseAdmin
        .from('proximity_alert_settings')
        .update({ is_active, updated_at: new Date().toISOString(), updated_by: user.id })
        .eq('id', 1);
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ is_active }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('[admin-run-proximity-scan] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
