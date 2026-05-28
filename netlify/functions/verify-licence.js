/* eslint-disable */
// Safe requires — if any module is missing the catch below will report it
let createClient, https, crypto;
try {
  createClient = require('@supabase/supabase-js').createClient;
  https        = require('https');
  crypto       = require('crypto');
} catch (initErr) {
  // Report the missing module clearly instead of returning a generic 500
  exports.handler = async () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ verified: false, _initError: initErr.message }),
  });
  return; // stop module evaluation here
}

const SUPABASE_URL       = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY  = process.env.VERIFYNOW_API_KEY;

// ⚠️ Set to false for production
const USE_SANDBOX = true;

// ── Safe UUID — works on Node 14.0+ ──────────────────────────────────────────
function safeUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.randomBytes(1)[0] % 16;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Multipart builder — zero npm deps, works on any Node version ─────────────
function buildMultipart(textFields, fileFields) {
  const boundary = `----VNBoundary${Date.now().toString(16)}`;
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
      `Content-Type: image/jpeg${CRLF}${CRLF}`
    ));
    parts.push(buffer);
    parts.push(Buffer.from(CRLF));
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  return {
    body:        Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ── HTTPS POST — no fetch / no npm needed ─────────────────────────────────────
function httpsPost(url, reqHeaders, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  reqHeaders,
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

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  // Top-level try-catch — ANY uncaught error returns 200 with the message
  // so you can see the real problem instead of a generic 500
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let user;
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
      }
      user = data.user;
    } catch (authErr) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Auth error', _debug: authErr.message }) };
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

    const { licenceFrontImageBase64, licenceBackImageBase64 } = body;
    if (!licenceFrontImageBase64 || !licenceBackImageBase64) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: 'Both licenceFrontImageBase64 and licenceBackImageBase64 are required' }),
      };
    }

    // ── Convert to Buffers ──────────────────────────────────────────────────
    const toBuffer = b64 => {
      const raw = b64.includes(',') ? b64.split(',')[1] : b64;
      return Buffer.from(raw, 'base64');
    };
    const frontBuffer = toBuffer(licenceFrontImageBase64);
    const backBuffer  = toBuffer(licenceBackImageBase64);

    // ── Build multipart ─────────────────────────────────────────────────────
    const textFields = { bundle: 'id_document_verification' };
    if (USE_SANDBOX) textFields.mode = 'sandbox';

    const { body: formBody, contentType } = buildMultipart(textFields, [
      { name: 'front_image', buffer: frontBuffer, filename: 'licence-front.jpg' },
      { name: 'back_image',  buffer: backBuffer,  filename: 'licence-back.jpg'  },
    ]);

    // ── Call VerifyNow ──────────────────────────────────────────────────────
    let vnRes;
    try {
      vnRes = await httpsPost(
        'https://www.verifynow.co.za/api/external/id-document-verify',
        {
          'x-api-key':      VERIFYNOW_API_KEY,
          'Idempotency-Key': safeUUID(),
          'Content-Type':   contentType,
          'Content-Length': formBody.length,
        },
        formBody,
      );
    } catch (netErr) {
      console.error('[verify-licence] Network error:', netErr.message);
      await updateProfileSafe(supabase, user.id, { license_pending: true });
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: false, pending: true,
          message: 'Could not reach the verification service — pending manual review.',
        }),
      };
    }

    const vnResult = vnRes.json;
    console.log('[verify-licence] HTTP status:', vnRes.status);
    console.log('[verify-licence] VerifyNow response:', JSON.stringify(vnResult));

    // ── Handle API errors ───────────────────────────────────────────────────
    if (!vnRes.ok) {
      const errMsg =
        vnResult?.message ||
        vnResult?.error ||
        (Array.isArray(vnResult?.errors) ? vnResult.errors.join(', ') : null) ||
        `VerifyNow HTTP ${vnRes.status}`;

      console.warn('[verify-licence] VerifyNow error:', errMsg);

      if (vnRes.status >= 500) {
        await updateProfileSafe(supabase, user.id, { license_pending: true });
        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            verified: false, pending: true,
            message: `Verification service error (${vnRes.status}) — pending manual review.`,
          }),
        };
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ verified: false, message: `Verification failed: ${errMsg}`, _debug: vnResult }),
      };
    }

    // ── Interpret result ────────────────────────────────────────────────────
    const isVerified =
      vnResult.success === true ||
      vnResult.status  === 'completed' ||
      vnResult.status  === 'verified'  ||
      vnResult.status  === 'success'   ||
      vnResult.verified === true ||
      vnResult.results?.id_document_verification?.Status === 'Success' ||
      vnResult.results?.id_document_verification?.status === 'success' ||
      vnResult.result?.status  === 'success' ||
      vnResult.data?.status    === 'verified';

    if (isVerified) {
      const now = new Date().toISOString();
      await updateProfileSafe(supabase, user.id, {
        license_verified: true, license_pending: false,
      });
      // Badge columns — only written if migration has been run
      try {
        const { data: profile } = await supabase
          .from('profiles').select('id_verified').eq('id', user.id).single();
        const badge = profile?.id_verified ? 'fully_verified' : 'licence_only';
        await supabase.from('profiles').update({
          licence_verified: true, licence_verified_at: now, verification_badge: badge,
        }).eq('id', user.id);
      } catch (e) {
        console.warn('[verify-licence] Badge update skipped:', e.message);
      }
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ verified: true, message: 'Driving licence verified successfully.' }),
      };
    }

    const failMsg =
      vnResult.message ||
      vnResult.reason  ||
      vnResult.results?.id_document_verification?.Message ||
      'Licence could not be verified. Ensure both images are clear and try again.';

    console.warn('[verify-licence] Not verified. Raw result:', JSON.stringify(vnResult));
    await updateProfileSafe(supabase, user.id, { license_verified: false });
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message: failMsg, _debug: vnResult }),
    };

  } catch (fatal) {
    // Catches anything we missed — returns 200 with the real error
    // so the frontend shows it instead of a generic 500
    console.error('[verify-licence] FATAL unhandled error:', fatal.message, fatal.stack);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        message: `Server error: ${fatal.message}`,
        _fatal: fatal.stack,
      }),
    };
  }
};

// ── Safe profile updater ──────────────────────────────────────────────────────
async function updateProfileSafe(supabase, userId, fields) {
  try {
    const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
    if (error) console.error('[verify-licence] Profile update error:', error.message);
  } catch (err) {
    console.error('[verify-licence] Profile update threw:', err.message);
  }
}
