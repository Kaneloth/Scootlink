const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const FormData = require('form-data');   // <-- npm install form-data

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

  // ── Auth ──────────────────────────────────────────────────────────────
  const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  // ── Parse body ────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { licenceImageBase64 } = body;   // only the back image is required (barcode)
  if (!licenceImageBase64) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'licenceImageBase64 (back of licence) is required' }) };
  }

  // Convert base64 to buffer (strip possible data URI prefix)
  const toBuffer = (b64) => {
    const raw = b64.includes('base64,') ? b64.split('base64,')[1] : b64;
    return Buffer.from(raw, 'base64');
  };
  const imageBuffer = toBuffer(licenceImageBase64);

  // ── Call VerifyNow ────────────────────────────────────────────────────
  const form = new FormData();
  form.append('bundle', 'sadl_decode');               // ✅ correct bundle name
  if (USE_SANDBOX) form.append('mode', 'sandbox');
  form.append('front_image', imageBuffer, { filename: 'licence-back.jpg' });

  let vnResult;
  try {
    const vnRes = await fetch('https://www.verifynow.co.za/api/external/id-document-verify', {
      method: 'POST',
      headers: {
        'x-api-key': VERIFYNOW_API_KEY,
        'Idempotency-Key': randomUUID(),
        ...form.getHeaders(),
      },
      body: form,
    });

    vnResult = await vnRes.json();
    console.log('[verify-licence] VerifyNow response:', JSON.stringify(vnResult));

    if (!vnRes.ok) {
      const errMsg = vnResult?.message || vnResult?.error || `VerifyNow error ${vnRes.status}`;
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ verified: false, message: errMsg, _debug: vnResult }),
      };
    }
  } catch (err) {
    console.error('[verify-licence] Fetch error:', err);
    return {
      statusCode: 502, headers,
      body: JSON.stringify({ error: 'Verification service unavailable. Try again shortly.' }),
    };
  }

  // ── Interpret result ──────────────────────────────────────────────────
  // SADL decode response may vary; adapt based on sandbox output.
  const isVerified =
    vnResult.success === true ||
    vnResult.status === 'completed' ||
    vnResult.status === 'verified' ||
    (vnResult.results?.sadl_decode?.Status === 'Success');

  if (isVerified) {
    await updateProfileWithLicence(supabase, user.id, true);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: true, message: 'Driving licence verified.' }),
    };
  } else {
    const message = vnResult.message || vnResult.reason || 'Licence could not be verified. Please ensure the image is clear and try again.';
    await updateProfileWithLicence(supabase, user.id, false);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message }),
    };
  }
};

// ── Helper: update profiles table ───────────────────────────────────────
async function updateProfileWithLicence(supabase, userId, verified) {
  const now = new Date().toISOString();
  const update = {};

  if (verified) {
    // Determine badge level – Fully Verified if ID is also verified
    const { data: profile } = await supabase
      .from('profiles')
      .select('id_verified')
      .eq('id', userId)
      .single();

    const badge = profile?.id_verified ? 'fully_verified' : 'licence_only';
    update.licence_verified = true;
    update.licence_verified_at = now;
    update.license_verified = true;     // legacy column
    update.license_verified_at = now;
    update.license_pending = false;
    update.verification_badge = badge;
  } else {
    update.licence_verified = false;
    update.license_verified = false;
  }

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (error) {
    console.error('[verify-licence] Failed to update profile:', error);
  }
}