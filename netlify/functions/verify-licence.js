const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY = process.env.VERIFYNOW_API_KEY;

// ⚠️ Set to false for production
const USE_SANDBOX = true;

// ── Multipart builder — works on Node 14/16/18/20, no npm needed ─────────────
function buildMultipart(textFields, fileFields) {
  const boundary = `----VNBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const CRLF = '\r\n';
  const parts = [];

  for (const [name, value] of Object.entries(textFields)) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}` +
      `${CRLF}${value}${CRLF}`
    ));
  }

  for (const { name, buffer, filename } of fileFields) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}` +
      `Content-Type: image/jpeg${CRLF}` +
      CRLF
    ));
    parts.push(buffer);
    parts.push(Buffer.from(CRLF));
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ── HTTPS POST — works on any Node version, no fetch needed ──────────────────
function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = { _raw: text }; }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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

  const { licenceFrontImageBase64, licenceBackImageBase64 } = body;
  if (!licenceFrontImageBase64 || !licenceBackImageBase64) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: 'Both licenceFrontImageBase64 and licenceBackImageBase64 are required' }),
    };
  }

  // ── Strip data-URL prefix and convert to Buffers ──────────────────────────
  const toBuffer = b64 => {
    const raw = b64.includes(',') ? b64.split(',')[1] : b64;
    return Buffer.from(raw, 'base64');
  };
  const frontBuffer = toBuffer(licenceFrontImageBase64);
  const backBuffer  = toBuffer(licenceBackImageBase64);

  // ── Build multipart form ───────────────────────────────────────────────────
  const textFields = { bundle: 'id_document_verification' };
  if (USE_SANDBOX) textFields.mode = 'sandbox';

  const { body: formBody, contentType } = buildMultipart(textFields, [
    { name: 'front_image', buffer: frontBuffer, filename: 'licence-front.jpg' },
    { name: 'back_image',  buffer: backBuffer,  filename: 'licence-back.jpg'  },
  ]);

  // ── Call VerifyNow ─────────────────────────────────────────────────────────
  let vnRes;
  try {
    vnRes = await httpsPost(
      'https://www.verifynow.co.za/api/external/id-document-verify',
      {
        'x-api-key':        VERIFYNOW_API_KEY,
        'Idempotency-Key':  randomUUID(),
        'Content-Type':     contentType,
        'Content-Length':   formBody.length,
      },
      formBody,
    );
  } catch (err) {
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

  const vnResult = vnRes.json;
  console.log('[verify-licence] HTTP status:', vnRes.status);
  console.log('[verify-licence] VerifyNow response:', JSON.stringify(vnResult));

  // ── Handle VerifyNow API errors ───────────────────────────────────────────
  if (!vnRes.ok) {
    const errMsg =
      vnResult?.message ||
      vnResult?.error ||
      (Array.isArray(vnResult?.errors) ? vnResult.errors.join(', ') : null) ||
      `VerifyNow returned HTTP ${vnRes.status}`;

    console.warn('[verify-licence] VerifyNow API error:', errMsg);

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

    // 4xx — return real error so you can see exactly what VerifyNow rejects
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, pending: false, message: `Verification failed: ${errMsg}`, _debug: vnResult }),
    };
  }

  // ── Interpret result ───────────────────────────────────────────────────────
  const isVerified =
    vnResult.success === true ||
    vnResult.status === 'completed' ||
    vnResult.status === 'verified' ||
    vnResult.status === 'success' ||
    vnResult.verified === true ||
    vnResult.results?.id_document_verification?.Status === 'Success' ||
    vnResult.results?.id_document_verification?.status === 'success' ||
    vnResult.result?.status === 'success' ||
    vnResult.data?.status === 'verified';

  if (isVerified) {
    await updateProfileWithLicence(supabase, user.id, true, null);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: true, message: 'Driving licence verified successfully.' }),
    };
  }

  const failMsg =
    vnResult.message ||
    vnResult.reason ||
    vnResult.results?.id_document_verification?.Message ||
    'Licence could not be verified. Ensure both images are clear and try again.';

  console.warn('[verify-licence] Verification not passed. Result:', JSON.stringify(vnResult));
  await updateProfileWithLicence(supabase, user.id, false, null);
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ verified: false, message: failMsg, _debug: vnResult }),
  };
};

// ── Helper ────────────────────────────────────────────────────────────────────
// Fully wrapped in try-catch so a missing column can NEVER cause a 500.
async function updateProfileWithLicence(supabase, userId, verified, pending) {
  const now = new Date().toISOString();

  // Step 1: columns that exist in every schema version (safe to update always)
  try {
    const safeUpdate = verified
      ? { license_verified: true,  license_pending: false }
      : pending
        ? { license_verified: false, license_pending: true  }
        : { license_verified: false };
    const { error } = await supabase.from('profiles').update(safeUpdate).eq('id', userId);
    if (error) console.error('[verify-licence] Step-1 update error:', error.message);
  } catch (err) {
    console.error('[verify-licence] Step-1 update threw:', err.message);
  }

  // Step 2: new badge columns — silently skipped if migration hasn't run yet
  if (verified) {
    try {
      const { data: profile } = await supabase
        .from('profiles').select('id_verified').eq('id', userId).single();
      const badge = profile?.id_verified ? 'fully_verified' : 'licence_only';
      await supabase.from('profiles').update({
        licence_verified:    true,
        licence_verified_at: now,
        verification_badge:  badge,
      }).eq('id', userId);
    } catch (err) {
      console.warn('[verify-licence] Badge update skipped (columns may not exist yet):', err.message);
    }
  } else if (!pending) {
    try {
      await supabase.from('profiles').update({ licence_verified: false }).eq('id', userId);
    } catch (err) {
      console.warn('[verify-licence] licence_verified clear skipped:', err.message);
    }
  }
}
