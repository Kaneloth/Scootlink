/**
 * Netlify Function: admin-refund-requests
 * Admin-only read/write access to the refund_requests table.
 *
 * This is a record-keeping tool, not a payment integration — refunds are
 * paid out manually by the admin (EFT, PayFast merchant dashboard, etc.)
 * OUTSIDE this app. The 'mark_refunded' action only records that it was
 * done; it does not move any money itself.
 *
 * POST body:
 *   { action: 'list' }
 *   { action: 'mark_refunded', requestId: string }
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

  const { action, requestId } = body;

  try {
    if (action === 'list') {
      const { data: requests, error } = await supabaseAdmin
        .from('refund_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;

      const userIds = [...new Set((requests || []).map(r => r.user_id).filter(Boolean))];
      const { data: profiles } = userIds.length
        ? await supabaseAdmin.from('profiles').select('id, full_name, email, phone, customer_code').in('id', userIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      const merged = (requests || []).map(r => ({ ...r, profile: profileMap[r.user_id] || null }));
      return { statusCode: 200, body: JSON.stringify({ requests: merged }) };
    }

    if (action === 'mark_refunded') {
      if (!requestId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'requestId required' }) };
      }
      // Only transitions a currently-pending row, so double-clicking or two
      // admins racing on the same request can't double-process it.
      const { data, error } = await supabaseAdmin
        .from('refund_requests')
        .update({
          status:       'refunded',
          processed_at: new Date().toISOString(),
          processed_by: user.id,
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return { statusCode: 409, body: JSON.stringify({ error: 'This request was already processed (or does not exist).' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ request: data }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('[admin-refund-requests] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
