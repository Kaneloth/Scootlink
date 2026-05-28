const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const FormData = require('form-data');   // npm install form-data

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY = process.env.VERIFYNOW_API_KEY;

// ⚠️ Set to false for production
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

  const { licenceBackImageBase64 } = body;
  if (!licenceBackImageBase64) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'licenceBackImageBase64 (back of licence) is required' }) };
  }

  // Convert base64 to buffer (strip possible data URI prefix)
  const toBuffer = (b64) => {
    const raw = b64.includes('base64,') ? b64.split('base64,')[1] : b64;
    return Buffer.from(raw, 'base64');
  };

  let imageBuffer;
  try { imageBuffer = toBuffer(licenceBackImageBase64); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid base64 image data' }) }; }

  // ── Call VerifyNow ────────────────────────────────────────────────────
  const form = new FormData();
  form.append('bundle', 'sadl_decode');          // ✅ correct SADL bundle
  if (USE_SANDBOX) form.append('mode', 'sandbox');
  form.append('front_image', imageBuffer, { filename: 'licence-back.jpg' });

  let vnRes, vnResult;
  try {
    vnRes = await fetch('https://www.verifynow.co.za/api/external/id-document-verify', {
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
  } catch (err) {
    console.error('[verify-licence] Network error:', err);
    await updateProfileSafe(supabase, user.id, { license_pending: true, licence_verified: false });
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        pending: true,
        message: 'Verification service unreachable. Your image has been saved — pending manual review.',
      }),
    };
  }

  if (!vnRes.ok) {
    const errMsg = vnResult?.message || vnResult?.error || `VerifyNow HTTP ${vnRes.status}`;
    // If the bundle isn't recognised, fallback to pending review
    if (errMsg.toLowerCase().includes('bundle') || vnRes.status === 404) {
      await updateProfileSafe(supabase, user.id, { license_pending: true, licence_verified: false });
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: false,
          pending: true,
          message: 'Licence images submitted — pending manual review.',
        }),
      };
    }
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message: `Verification failed: ${errMsg}`, _debug: vnResult }),
    };
  }

  // ── Interpret result ──────────────────────────────────────────────────
  const isVerified =
    vnResult.success === true ||
    vnResult.status === 'completed' ||
    vnResult.status === 'verified' ||
    (vnResult.results?.sadl_decode?.Status === 'Success');

  if (isVerified) {
    await updateProfileSafe(supabase, user.id, {
      licence_verified: true,
      licence_verified_at: new Date().toISOString(),
      license_verified: true,
      license_verified_at: new Date().toISOString(),
      license_pending: false,
    });
    // Determine badge level
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id_verified')
        .eq('id', user.id)
        .single();
      const badge = profile?.id_verified ? 'fully_verified' : 'licence_only';
      await supabase.from('profiles').update({ verification_badge: badge }).eq('id', user.id);
    } catch { /* badge update failure is non‑critical */ }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: true, message: 'Driving licence verified successfully.' }),
    };
  } else {
    await updateProfileSafe(supabase, user.id, { licence_verified: false });
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        message: vnResult.message || vnResult.reason || 'Licence could not be verified. Please ensure the image is clear.',
        _debug: vnResult,
      }),
    };
  }
};

// ── Safe profile updater (wrapped in try‑catch) ──────────────────────────
async function updateProfileSafe(supabase, userId, fields) {
  try {
    await supabase.from('profiles').update(fields).eq('id', userId);
  } catch (err) {
    console.error('[verify-licence] Profile update failed:', err.message);
    // Don't throw – let the function continue gracefully
  }
}