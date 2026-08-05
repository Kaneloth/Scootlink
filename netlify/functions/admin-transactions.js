/**
 * Netlify Function: admin-transactions
 * Admin-only read access to a unified "real money" transaction ledger,
 * combining three sources:
 *   - credit_ledger (type IN 'purchase', 'refund' only — excludes
 *     signup_bonus/admin grants (free, no money involved), spend
 *     (credits being used, not money changing hands with us), and
 *     adjustment (unclear provenance, not one of the three requested
 *     categories — flagged for a follow-up if it turns out to matter))
 *   - verification_payments (status = 'paid')
 *   - refund_requests (status = 'refunded')
 *
 * This is read-only reporting — no action a click here can take moves any
 * money. That already happens elsewhere (PayFast, or an admin's own manual
 * refund process); this just shows what happened.
 *
 * POST body: { action: 'list' }
 * Auth: Bearer token, verified to belong to an admin (user_metadata.is_admin === true)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Most recent N per source, before merging — plenty of headroom for a
// reporting view; increase if this ever needs true full-history pagination.
const LIST_LIMIT = 200;

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
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (body.action !== 'list') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  try {
    const [creditRes, verifRes, refundRes] = await Promise.all([
      supabaseAdmin
        .from('credit_ledger')
        .select('id, user_id, amount, type, description, ref_id, created_at')
        .in('type', ['purchase', 'refund'])
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT),
      supabaseAdmin
        .from('verification_payments')
        .select('id, user_id, service_type, amount, m_payment_id, paid_at, created_at')
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT),
      supabaseAdmin
        .from('refund_requests')
        .select('id, user_id, service_type, amount, reason, processed_at, created_at')
        .eq('status', 'refunded')
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT),
    ]);

    if (creditRes.error) throw creditRes.error;
    if (verifRes.error) throw verifRes.error;
    if (refundRes.error) throw refundRes.error;

    // credit_ledger.amount is a credit count, not Rand — shown with its own
    // unit rather than forced into a single currency column.
    const creditRows = (creditRes.data || []).map(r => ({
      id:      `credit_${r.id}`,
      user_id: r.user_id,
      type:    r.type === 'purchase' ? 'credit_purchase' : 'credit_refund',
      label:   r.type === 'purchase' ? 'Credit Purchase' : 'Credit Refund',
      amount:  r.amount,
      unit:    'credits',
      detail:  r.description || null,
      date:    r.created_at,
    }));

    const verifRows = (verifRes.data || []).map(r => ({
      id:      `verif_${r.id}`,
      user_id: r.user_id,
      type:    'verification_payment',
      label:   'Verification Payment',
      amount:  Number(r.amount),
      unit:    'ZAR',
      detail:  r.service_type,
      date:    r.paid_at || r.created_at,
    }));

    const refundRows = (refundRes.data || []).map(r => ({
      id:      `cashrefund_${r.id}`,
      user_id: r.user_id,
      type:    'cash_refund',
      label:   'Cash Refund',
      amount:  Number(r.amount),
      unit:    'ZAR',
      detail:  [r.service_type, r.reason].filter(Boolean).join(' — ') || null,
      date:    r.processed_at || r.created_at,
    }));

    const merged = [...creditRows, ...verifRows, ...refundRows]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const userIds = [...new Set(merged.map(r => r.user_id).filter(Boolean))];
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from('profiles').select('id, full_name, email, customer_code').in('id', userIds)
      : { data: [] };
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

    const transactions = merged.map(r => ({ ...r, profile: profileMap[r.user_id] || null }));

    return { statusCode: 200, body: JSON.stringify({ transactions }) };
  } catch (err) {
    console.error('[admin-transactions] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
