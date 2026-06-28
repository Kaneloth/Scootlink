/**
 * verify-licence.js — zero npm dependencies
 * Uses only Node built-ins: https, crypto, Buffer
 * Supabase calls go directly to the REST API (no @supabase/supabase-js needed)
 */
const https  = require('https');
const crypto = require('crypto');

const SUPABASE_URL       = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY  = process.env.VERIFYNOW_API_KEY;

// ── UUID helper — works on Node 14.0+ ────────────────────────────────────────
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

// ── Generic HTTPS request ─────────────────────────────────────────────────────
function request(method, url, reqHeaders, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers:  reqHeaders,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { json = { _raw: text }; }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json, text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Supabase helpers (REST API — no npm package) ──────────────────────────────
async function getUser(userToken) {
  const res = await request('GET', `${SUPABASE_URL}/auth/v1/user`, {
    Authorization: `Bearer ${userToken}`,
    apikey: SUPABASE_KEY,
  });
  if (!res.ok) return null;
  return res.json;
}

async function getProfile(userId) {
  const res = await request('GET',
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=id_verified&limit=1`,
    { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY }
  );
  if (!res.ok) return null;
  return Array.isArray(res.json) ? res.json[0] : res.json;
}

async function updateProfile(userId, fields) {
  const body = Buffer.from(JSON.stringify(fields));
  const res = await request('PATCH',
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
    {
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      apikey:         SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Content-Length': body.length,
      Prefer:         'return=minimal',
    },
    body,
  );
  if (!res.ok) console.error('[verify-licence] Profile update error:', res.status, res.text);
  return res.ok;
}

// ── Multipart builder ─────────────────────────────────────────────────────────
function buildMultipart(textFields, fileFields) {
  const boundary = `----VNBdy${Date.now().toString(16)}`;
  const CRLF = '\r\n';
  const parts = [];

  for (const [name, value] of Object.entries(textFields)) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`
    ));
  }
  for (const { name, buffer, filename } of fileFields) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}Content-Type: image/jpeg${CRLF}${CRLF}`
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

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
  };

  try {
    console.log('[verify-licence] START method=%s bodyLen=%d', event.httpMethod, (event.body||'').length);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
    if (event.httpMethod !== 'POST')
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    // ── Auth ──────────────────────────────────────────────────────────────
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) {
      console.log('[verify-licence] EARLY EXIT: no token');
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized — no token' }) };
    }

    const user = await getUser(token);
    if (!user || !user.id) {
      console.log('[verify-licence] EARLY EXIT: invalid session');
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session — please log out and back in' }) };
    }
    console.log('[verify-licence] User OK:', user.id);

    // ── Parse body ────────────────────────────────────────────────────────
    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

    const { licenceFrontImageBase64, licenceBackImageBase64 } = body;
    if (!licenceFrontImageBase64 || !licenceBackImageBase64) {
      console.log('[verify-licence] EARLY EXIT: missing images');
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Both front and back licence images are required' }) };
    }

    // ── Convert to Buffers ────────────────────────────────────────────────
    const toBuffer = b64 => Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64');
    const frontBuf = toBuffer(licenceFrontImageBase64);
    const backBuf  = toBuffer(licenceBackImageBase64);
    console.log('[verify-licence] Image sizes: front=%dB back=%dB', frontBuf.length, backBuf.length);

    // ── Build multipart ───────────────────────────────────────────────────
    const textFields = { bundle: 'id_document_verification' };

    const { body: formBody, contentType } = buildMultipart(textFields, [
      { name: 'front_image', buffer: frontBuf, filename: 'licence-front.jpg' },
      { name: 'back_image',  buffer: backBuf,  filename: 'licence-back.jpg'  },
    ]);
    console.log('[verify-licence] Multipart built: %dB', formBody.length);

    // ── Call VerifyNow ────────────────────────────────────────────────────
    let vnRes;
    try {
      vnRes = await request('POST',
        'https://www.verifynow.co.za/api/external/id-document-verify',
        {
          'x-api-key':      VERIFYNOW_API_KEY,
          'Idempotency-Key': uuid(),
          'Content-Type':   contentType,
          'Content-Length': formBody.length,
        },
        formBody,
      );
    } catch (netErr) {
      console.error('[verify-licence] Network error:', netErr.message);
      await updateProfile(user.id, { license_pending: true });
      return { statusCode: 200, headers, body: JSON.stringify({
        verified: false, pending: true,
        message: 'Could not reach VerifyNow — your images are saved, pending manual review.',
      })};
    }

    const vn = vnRes.json;
    console.log('[verify-licence] VerifyNow HTTP=%d response=%s', vnRes.status, JSON.stringify(vn));

    // ── Handle VerifyNow errors ───────────────────────────────────────────
    if (!vnRes.ok) {
      const errMsg = vn?.message || vn?.error || (Array.isArray(vn?.errors) ? vn.errors.join(', ') : null) || `HTTP ${vnRes.status}`;
      if (vnRes.status >= 500) {
        await updateProfile(user.id, { license_pending: true });
        return { statusCode: 200, headers, body: JSON.stringify({
          verified: false, pending: true,
          message: `VerifyNow service error (${vnRes.status}) — pending manual review.`,
        })};
      }
      return { statusCode: 200, headers, body: JSON.stringify({
        verified: false, message: `Verification failed: ${errMsg}`, _debug: vn,
      })};
    }

    // ── Interpret result ──────────────────────────────────────────────────
    const isVerified =
      vn.success === true       ||
      vn.status  === 'completed'||
      vn.status  === 'verified' ||
      vn.status  === 'success'  ||
      vn.verified === true      ||
      vn.results?.id_document_verification?.Status === 'Success' ||
      vn.results?.id_document_verification?.status === 'success' ||
      vn.result?.status === 'success' ||
      vn.data?.status   === 'verified';

    if (isVerified) {
      const now = new Date().toISOString();
      await updateProfile(user.id, { license_verified: true, license_pending: false });
      try {
        const profile = await getProfile(user.id);
        const badge   = profile?.id_verified ? 'fully_verified' : 'dl_verified';
        await updateProfile(user.id, { licence_verified: true, licence_verified_at: now, verification_badge: badge });
      } catch (e) {
        console.warn('[verify-licence] Badge update skipped:', e.message);
      }
      console.log('[verify-licence] VERIFIED user=%s', user.id);
      return { statusCode: 200, headers, body: JSON.stringify({ verified: true, message: 'Driving licence verified successfully.' }) };
    }

    const failMsg = vn.message || vn.reason || vn.results?.id_document_verification?.Message ||
      'Licence could not be verified. Ensure both images are clear and try again.';
    console.warn('[verify-licence] NOT verified. Result:', JSON.stringify(vn));
    await updateProfile(user.id, { license_verified: false });
    return { statusCode: 200, headers, body: JSON.stringify({ verified: false, message: failMsg, _debug: vn }) };

  } catch (fatal) {
    console.error('[verify-licence] FATAL:', fatal.message, fatal.stack);
    return { statusCode: 200, headers, body: JSON.stringify({
      verified: false, message: `Server error: ${fatal.message}`, _fatal: fatal.stack,
    })};
  }
};
