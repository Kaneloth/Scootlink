/**
 * Netlify Function: admin-review-identity-verification
 *
 * Approves or rejects a pending identity_verification_submissions row.
 * Documents are deleted from Storage either way — nothing is kept
 * permanently once reviewed, per data-minimisation intent (POPIA).
 *
 * On rejection, the payment that was consumed at submission time is
 * un-consumed (used: false) so the user gets exactly one free retry,
 * matching "no additional fee for re-submission of the same type".
 *
 * POST body: { submissionId, action: 'approve' | 'reject', rejectionReason? }
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user: adminUser } } = await supabase.auth.getUser(token);
  if (!adminUser) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

  const { data: adminProfile } = await supabase.from('profiles').select('is_admin').eq('id', adminUser.id).maybeSingle();
  if (!adminProfile?.is_admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { submissionId, action, rejectionReason } = body;
  if (!submissionId || !['approve', 'reject'].includes(action)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'submissionId and a valid action are required' }) };
  }

  const { data: submission, error: fetchErr } = await supabase
    .from('identity_verification_submissions')
    .select('*')
    .eq('id', submissionId)
    .single();

  if (fetchErr || !submission) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Submission not found' }) };
  }
  if (submission.verification_status !== 'pending') {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'This submission has already been reviewed' }) };
  }

  // ── Delete documents from storage regardless of outcome ─────────────────
  const paths = [submission.document_front_path, submission.document_back_path, submission.selfie_path].filter(Boolean);
  if (paths.length) {
    const { error: delErr } = await supabase.storage.from('identity-documents').remove(paths);
    if (delErr) console.warn('[admin-review-identity-verification] Storage delete failed (non-fatal):', delErr.message);
  }

  const now = new Date().toISOString();
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  await supabase.from('identity_verification_submissions').update({
    verification_status: newStatus,
    rejection_reason: action === 'reject' ? (rejectionReason || null) : null,
    reviewed_by: adminUser.id,
    reviewed_at: now,
    // Clear the path columns since the files no longer exist.
    document_front_path: null,
    document_back_path: null,
    selfie_path: null,
  }).eq('id', submissionId);

  if (action === 'approve') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id_verified, licence_verified')
      .eq('id', submission.user_id)
      .maybeSingle();

    if (submission.service_type === 'licence') {
      const badge = profile?.id_verified ? 'fully_verified' : 'dl_verified';
      await supabase.from('profiles').update({
        licence_verified: true,
        licence_verified_at: now,
        license_verified: true,
        license_pending: false,
        verification_badge: badge,
      }).eq('id', submission.user_id);
    } else {
      const badge = profile?.licence_verified ? 'fully_verified' : 'id_verified';
      await supabase.from('profiles').update({
        id_verified: true,
        id_verified_at: now,
        verified: true,
        verification_badge: badge,
        verification_reference: submission.id,
        verification_date: now,
      }).eq('id', submission.user_id);
    }

    // Sync to auth metadata so auth.me() reflects it immediately, matching
    // the old verify-identity.js behaviour.
    await supabase.auth.admin.updateUserById(submission.user_id, {
      user_metadata: { verified: true },
    }).catch((e) => console.warn('[admin-review-identity-verification] metadata sync skipped:', e.message));

  } else {
    // Rejected — free retry: un-consume the payment used for this submission.
    const { data: paymentToRefund } = await supabase
      .from('verification_payments')
      .select('id')
      .eq('user_id', submission.user_id)
      .eq('service_type', submission.service_type)
      .eq('status', 'paid')
      .eq('used', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentToRefund) {
      await supabase.from('verification_payments').update({ used: false }).eq('id', paymentToRefund.id);
    }

    if (submission.service_type === 'licence') {
      await supabase.from('profiles').update({ license_pending: false }).eq('id', submission.user_id);
    }
  }

  console.log(`[admin-review-identity-verification] ${newStatus}: submission=${submissionId} user=${submission.user_id} service=${submission.service_type} admin=${adminUser.id}`);
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: newStatus }) };
};
