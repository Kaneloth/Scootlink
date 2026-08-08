/**
 * Netlify Function: admin-gig-verification
 * Admin-only approve/reject for driver_gig_verification submissions
 * (Delivery-Ready / Passenger-Ready tiers — see 001_gigs_schema.sql).
 *
 * OPEN QUESTION, not resolved here: identity verification
 * (admin-review-identity-verification.js) deletes uploaded documents
 * from Storage on review either way, for POPIA data-minimisation.
 * This function currently does NOT delete driver_gig_verification
 * documents — unclear whether the same policy should apply here, or
 * whether these need retaining longer for driver-eligibility audit
 * purposes. Left as-is pending a decision, not an oversight.
 *
 * POST body:
 *   { action: 'list' }
 *   { action: 'review', verificationId: string, decision: 'approve' | 'reject', rejectionReason?: string }
 * Auth: Bearer token, verified to belong to an admin (user_metadata.is_admin === true)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function notify(userId, type, title, body, data = null) {
  try {
    await supabaseAdmin.rpc('create_notification', {
      p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
    });
  } catch (err) {
    console.error('[admin-gig-verification] notify failed:', err.message);
  }
}

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

  try {
    if (body.action === 'list') {
      const { data: pending, error } = await supabaseAdmin
        .from('driver_gig_verification')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;

      const userIds = [...new Set((pending || []).map(v => v.driver_id).filter(Boolean))];
      const { data: profiles } = userIds.length
        ? await supabaseAdmin.from('profiles').select('id, full_name, email, phone, customer_code').in('id', userIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      const merged = (pending || []).map(v => ({ ...v, profile: profileMap[v.driver_id] || null }));
      return { statusCode: 200, body: JSON.stringify({ submissions: merged }) };
    }

    if (body.action === 'review') {
      const { verificationId, decision, rejectionReason } = body;
      if (!verificationId || !['approve', 'reject'].includes(decision)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'verificationId and a valid decision are required' }) };
      }

      // Only transitions a currently-pending row — matches the
      // race-guard pattern in admin-refund-requests.js's mark_refunded.
      const now = new Date().toISOString();
      const newStatus = decision === 'approve' ? 'approved' : 'rejected';

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('driver_gig_verification')
        .update({
          status: newStatus,
          rejection_reason: decision === 'reject' ? (rejectionReason || null) : null,
          verified_at: decision === 'approve' ? now : null,
          verified_by: user.id,
          updated_at: now,
        })
        .eq('id', verificationId)
        .eq('status', 'pending')
        .select()
        .maybeSingle();

      if (updateErr) throw updateErr;
      if (!updated) {
        return { statusCode: 409, body: JSON.stringify({ error: 'This submission was already reviewed (or does not exist).' }) };
      }

      const tierLabel = updated.tier === 'passenger_ready' ? 'Passenger-Ready' : 'Delivery-Ready';
      if (decision === 'approve') {
        await notify(
          updated.driver_id, 'gig_verification_approved',
          `You're ${tierLabel}!`,
          `Your ${tierLabel} verification was approved. You can now see matching gigs.`,
          { verification_id: updated.id },
        );
      } else {
        await notify(
          updated.driver_id, 'gig_verification_rejected',
          'Verification not approved',
          rejectionReason || `Your ${tierLabel} verification was not approved. Please review and resubmit.`,
          { verification_id: updated.id },
        );
      }

      console.log(`[admin-gig-verification] ${newStatus}: verification=${verificationId} driver=${updated.driver_id} tier=${updated.tier} admin=${user.id}`);
      return { statusCode: 200, body: JSON.stringify({ submission: updated }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('[admin-gig-verification] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
