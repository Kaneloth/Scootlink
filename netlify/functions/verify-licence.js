const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY = process.env.VERIFYNOW_API_KEY;

// ⚠️ SANDBOX MODE — set to false for production
const USE_SANDBOX = true;

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

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { licenceImageBase64 } = body;
  if (!licenceImageBase64) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: 'licenceImageBase64 (back/barcode side of licence) is required' }),
    };
  }

  // ── Strip data-URL prefix and convert to Buffer ───────────────────────────
  // e.g. "data:image/jpeg;base64,/9j/4..." → "/9j/4..."
  const raw = licenceImageBase64.includes(',') ? licenceImageBase64.split(',')[1] : licenceImageBase64;
  const imageBuffer = Buffer.from(raw, 'base64');

  // ── Build multipart form using native Node.js FormData + Blob ─────────────
  // Node 18+ (used by Netlify Functions) has global FormData and Blob.
  // No npm package needed — avoids the "Cannot find module 'form-data'" 500.
  const form = new FormData();
  form.append('bundle', 'sadl_decode');           // SA Driving Licence barcode decode
  if (USE_SANDBOX) form.append('mode', 'sandbox');
  form.append(
    'front_image',                                // VerifyNow field name for the uploaded image
    new Blob([imageBuffer], { type: 'image/jpeg' }),
    'licence-back.jpg',
  );

  // ── Call VerifyNow ─────────────────────────────────────────────────────────
  let vnResult;
  try {
    const vnRes = await fetch('https://www.verifynow.co.za/api/external/id-document-verify', {
      method: 'POST',
      headers: {
        'x-api-key':       VERIFYNOW_API_KEY,
        'Idempotency-Key': randomUUID(),
        // ⚠️ Do NOT set Content-Type manually — fetch sets it automatically
        //    with the correct multipart boundary when body is a FormData object.
      },
      body: form,
    });

    vnResult = await vnRes.json();
    console.log('[verify-licence] VerifyNow response:', JSON.stringify(vnResult));

    if (!vnRes.ok) {
      console.warn('[verify-licence] VerifyNow HTTP error — falling back to pending review:', vnResult);
      await updateProfileWithLicence(supabase, user.id, false, 'pending_manual_review');
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: false,
          pending:  true,
          message:  'Licence image submitted — pending manual review. You will be notified once verified.',
        }),
      };
    }
  } catch (err) {
    console.error('[verify-licence] Fetch error:', err);
    await updateProfileWithLicence(supabase, user.id, false, 'pending_review');
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        pending:  true,
        message:  'Verification service temporarily unavailable. Your image has been recorded — pending review.',
      }),
    };
  }

  // ── Interpret sadl_decode result ───────────────────────────────────────────
  const isVerified =
    vnResult.success === true ||
    vnResult.status === 'completed' ||
    vnResult.status === 'verified' ||
    (vnResult.results?.sadl_decode?.Status === 'Success');

  if (isVerified) {
    await updateProfileWithLicence(supabase, user.id, true, null);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: true, message: 'Driving licence verified successfully.' }),
    };
  }

  const message =
    vnResult.message ||
    vnResult.reason ||
    'Licence could not be verified. Please ensure the image is clear and shows the barcode, then try again.';
  await updateProfileWithLicence(supabase, user.id, false, null);
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ verified: false, message }),
  };
};

// ── Helper: write licence result to profiles ──────────────────────────────────
async function updateProfileWithLicence(supabase, userId, verified, pending) {
  const update = {};

  if (verified) {
    const now = new Date().toISOString();

    // Determine badge — Fully Verified if ID is also verified
    const { data: profile } = await supabase
      .from('profiles')
      .select('id_verified')
      .eq('id', userId)
      .single();

    const badge = profile?.id_verified ? 'fully_verified' : 'licence_only';

    update.licence_verified    = true;   // new badge column (British spelling — matches frontend)
    update.licence_verified_at = now;
    update.license_verified    = true;   // legacy column — keep in sync
    update.license_verified_at = now;
    update.license_pending     = false;
    update.verification_badge  = badge;
  } else if (pending) {
    update.license_pending  = true;
    update.licence_verified = false;
    update.license_verified = false;
  }

  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (error) {
    console.error('[verify-licence] Failed to update profile:', error);
  }
}
