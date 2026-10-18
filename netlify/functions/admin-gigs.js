/**
 * Netlify Function: admin-gigs
 * Admin-only oversight of gigs (migration 015).
 *
 * POST body:
 *   { action: 'list', filter: 'active' | 'disputed' | 'completed' | 'cancelled' | 'all' }
 *   { action: 'resolve_dispute', gigId: number, outcome: 'release' | 'void', note?: string }
 *   { action: 'cancel', gigId: number, note?: string }
 * Auth: Bearer token, verified to belong to an admin (user_metadata.is_admin === true),
 * the same check as the other admin-* functions.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const FILTERS = {
  active: ['awaiting_payment', 'pending', 'accepted', 'in_progress'],
  disputed: ['disputed'],
  completed: ['completed'],
  cancelled: ['cancelled', 'no_drivers_available'],
};

async function notify(userId, type, title, body, data = null) {
  if (!userId) return;
  try {
    const { error } = await supabaseAdmin.rpc('create_notification', {
      p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[admin-gigs] notify failed:', err.message);
  }
}

const reply = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return reply(401, { error: 'Missing authorization token' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || user.user_metadata?.is_admin !== true) {
    return reply(403, { error: 'Admin access required' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  try {
    if (body.action === 'list') {
      let q = supabaseAdmin
        .from('gig_requests')
        .select('id, gig_type, status, payment_method, payment_status, customer_id, driver_id, pickup_address, dropoff_address, fare_amount, cancellation_fee, customer_no_show, commission_amount, driver_payout_amount, dispute_reason, admin_resolution, admin_note, created_at, accepted_at, started_at, completed_at, cancelled_at, cancelled_by, disputed_at, auto_confirmed')
        .order('created_at', { ascending: false })
        .limit(100);
      const statuses = FILTERS[body.filter];
      if (statuses) q = q.in('status', statuses);
      const { data: gigs, error } = await q;
      if (error) throw error;

      const ids = [...new Set((gigs || []).flatMap((g) => [g.customer_id, g.driver_id]).filter(Boolean))];
      const { data: profiles, error: pErr } = ids.length
        ? await supabaseAdmin.from('profiles').select('id, full_name, email, phone, customer_code').in('id', ids)
        : { data: [], error: null };
      if (pErr) throw pErr;
      const byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

      return reply(200, {
        gigs: (gigs || []).map((g) => ({
          ...g,
          customer: byId[g.customer_id] || null,
          driver: g.driver_id ? byId[g.driver_id] || null : null,
        })),
      });
    }

    if (body.action === 'resolve_dispute') {
      const gigId = Number(body.gigId);
      if (!Number.isInteger(gigId) || !['release', 'void'].includes(body.outcome)) {
        return reply(400, { error: 'gigId and an outcome of release or void are required' });
      }
      const { data: gig, error } = await supabaseAdmin.rpc('admin_resolve_gig_dispute', {
        p_gig_id: gigId, p_outcome: body.outcome, p_admin_id: user.id, p_note: body.note || null,
      });
      if (error) return reply(400, { error: error.message });

      if (body.outcome === 'release') {
        await notify(gig.customer_id, 'gig_resolved', 'Your report was reviewed',
          'We reviewed your report and closed it. The gig has been completed.', { gig_id: gig.id });
        await notify(gig.driver_id, 'gig_resolved', 'Dispute resolved in your favour',
          'The reported gig was reviewed and completed. Your earnings have been recorded.', { gig_id: gig.id });
      } else {
        await notify(gig.customer_id, 'gig_resolved', 'Your report was upheld',
          'We reviewed your report and voided the gig.', { gig_id: gig.id });
        await notify(gig.driver_id, 'gig_resolved', 'Dispute resolved',
          'The reported gig was reviewed and voided. No earnings were recorded for it.', { gig_id: gig.id });
      }
      return reply(200, { gig });
    }

    if (body.action === 'cancel') {
      const gigId = Number(body.gigId);
      if (!Number.isInteger(gigId)) return reply(400, { error: 'gigId is required' });
      const { data: gig, error } = await supabaseAdmin.rpc('admin_cancel_gig', {
        p_gig_id: gigId, p_admin_id: user.id, p_note: body.note || null,
      });
      if (error) return reply(400, { error: error.message });

      const msg = 'This gig was cancelled by Skootlink support.';
      await notify(gig.customer_id, 'gig_cancelled', 'Gig cancelled', msg, { gig_id: gig.id });
      await notify(gig.driver_id, 'gig_cancelled', 'Gig cancelled', msg, { gig_id: gig.id });
      return reply(200, { gig });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('[admin-gigs] Error:', err);
    return reply(500, { error: err.message || 'Internal error' });
  }
};
