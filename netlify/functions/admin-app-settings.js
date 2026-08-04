/**
 * Netlify Function: admin-app-settings
 * Admin-only read/write access to the app_settings table.
 *
 * POST body: { action: 'get' | 'toggle_profile_visibility', enabled?: boolean }
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

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || user.user_metadata?.is_admin !== true) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { action, enabled } = body;

  try {
    if (action === 'get') {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .select('profile_visibility_toggle_enabled, updated_at')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    if (action === 'toggle_profile_visibility') {
      if (typeof enabled !== 'boolean') {
        return { statusCode: 400, body: JSON.stringify({ error: 'enabled must be true or false' }) };
      }
      const { error } = await supabaseAdmin
        .from('app_settings')
        .update({
          profile_visibility_toggle_enabled: enabled,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', 1);
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ profile_visibility_toggle_enabled: enabled }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('[admin-app-settings] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
