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
  const raw = licenceImageBase64.includes(',') ? licenceImageBase64.split(',')[1] : licenceImageBase64;
  const imageBuffer = Buffer.from(raw, 'base64');

  // ── Build multipart form (native Node 18 FormData — no npm package needed) ─
  const form = new FormData();
  form.append('bundle', 'sadl_decode');
  if (USE_SANDBOX) form.append('mode', 'sandbox');
  form.append(
    'front_image',
    new Blob([imageBuffer], { type: 'image/jpeg' }),
    'licence-back.jpg',
  );

  // ── Call VerifyNow ─────────────────────────────────────────────────────────
  let vnRes, vnResult;
  try {
    vnRes = await fetch('https://www.verifynow.co.za/api/external/id-document-verify', {
      method: 'POST',
      headers: {
        'x-api-key':       VERIFYNOW_API_KEY,
        'Idempotency-Key': randomUUID(),
        // ⚠️ Do NOT set Content-Type — fetch sets it with the correct multipart boundary
      },
      body: form,
    });
    vnResult = await vnRes.json();
  } catch (err) {
    // Network failure — save as pending so the user isn't stuck
    console.error('[verify-licence] Network error calling VerifyNow:', err.message);
    await updateProfileWithLicence(supabase, user.id, false, 'pending_network_error');
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        pending:  true,
        message:  'Could not reach the verification service. Your image has been saved — pending manual review.',
      }),
    };
  }

  // ── Always log the full VerifyNow response ────────────────────────────────
  console.log('[verify-licence] HTTP status:', vnRes.status);
  console.log('[verify-licence] VerifyNow response:', JSON.stringify(vnResult));

  // ── Handle VerifyNow API errors ───────────────────────────────────────────
  if (!vnRes.ok) {
    // Extract the most useful error message from the response
    const errMsg =
      vnResult?.message ||
      vnResult?.error ||
      vnResult?.errors?.join(', ') ||
      `VerifyNow returned HTTP ${vnRes.status}`;

    console.warn('[verify-licence] VerifyNow API error:', errMsg, JSON.stringify(vnResult));

    // 5xx = their server is down → save as pending so user doesn't lose their submission
    if (vnRes.status >= 500) {
      await updateProfileWithLicence(supabase, user.id, false, 'pending_service_down');
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: false,
          pending:  true,
          message:  `Verification service error (${vnRes.status}). Your image has been saved — pending manual review.`,
        }),
      };
    }

    // 4xx = client error (bad bundle name, bundle not enabled, bad image, etc.)
    // Return the real error so it shows in the app — do NOT silently save as pending.
    // This way you can see exactly what VerifyNow is rejecting.
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        pending:  false,
        message:  `Verification failed: ${errMsg}`,
        _debug:   vnResult,  // full VerifyNow response visible in browser network tab
      }),
    };
  }

  // ── Interpret sadl_decode result ───────────────────────────────────────────
  // Log the exact shape so you can see what field to check
  console.log('[verify-licence] Full result object keys:', Object.keys(vnResult));

  const isVerified =
    vnResult.success === true ||
    vnResult.status === 'completed' ||
    vnResult.status === 'verified' ||
    vnResult.status === 'success' ||
    vnResult.verified === true ||
    (vnResult.results?.sadl_decode?.Status === 'Success') ||
    (vnResult.result?.status === 'success') ||
    (vnResult.data?.status === 'verified');

  if (isVerified) {
    await updateProfileWithLicence(supabase, user.id, true, null);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: true, message: 'Driving licence verified successfully.' }),
    };
  }

  // Verification ran but result is not a clear pass
  const failMsg =
    vnResult.message ||
    vnResult.reason ||
    vnResult.results?.sadl_decode?.Message ||
    'Licence could not be verified. Ensure the image shows the barcode clearly and try again.';

  console.warn('[verify-licence] Verification not passed. Result:', JSON.stringify(vnResult));
  await updateProfileWithLicence(supabase, user.id, false, null);
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ verified: false, message: failMsg, _debug: vnResult }),
  };
};

// ── Helper ────────────────────────────────────────────────────────────────────
async function updateProfileWithLicence(supabase, userId, verified, pending) {
  const now = new Date().toISOString();

  // Step 1: safe columns (exist in all schema versions)
  const safeUpdate = verified
    ? { license_verified: true, license_pending: false }
    : pending
      ? { license_verified: false, license_pending: true }
      : { license_verified: false };

  const { error: e1 } = await supabase.from('profiles').update(safeUpdate).eq('id', userId);
  if (e1) console.error('[verify-licence] Safe update error:', e1.message);

  // Step 2: new badge columns (silently ignored if migration not yet run)
  if (verified) {
    const { data: profile } = await supabase
      .from('profiles').select('id_verified').eq('id', userId).single();
    const badge = profile?.id_verified ? 'fully_verified' : 'licence_only';
    await supabase.from('profiles').update({
      licence_verified:    true,
      licence_verified_at: now,
      verification_badge:  badge,
    }).eq('id', userId);
  } else if (!pending) {
    await supabase.from('profiles').update({ licence_verified: false }).eq('id', userId);
  }
}
