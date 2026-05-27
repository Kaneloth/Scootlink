const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY = process.env.VERIFYNOW_API_KEY;

// ⚠️ SANDBOX MODE — Remove the `mode` field from both payloads below when going live

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { idNumber, documentType } = body;
  if (!idNumber || !documentType) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'idNumber and documentType are required' }) };
  }

  const cleanId = idNumber.trim().toUpperCase();

  // ── Blacklist check ───────────────────────────────────────────────────────
  const { data: banned } = await supabase
    .from('blacklisted_id_numbers')
    .select('id_number')
    .eq('id_number', cleanId)
    .maybeSingle();

  if (banned) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        message: 'This ID/passport has been flagged. Contact help@skootlink.co.za to resolve this.',
      }),
    };
  }

  // ── Call VerifyNow ────────────────────────────────────────────────────────
  // SA ID:     reportType = 'said_verification'
  // Passport:  reportType = 'document_authentication'   (confirm with VerifyNow if needed)
  const payload = {
    mode: 'sandbox', // ← remove this line for production (or set to 'live')
  };

  if (documentType === 'sa_id') {
    payload.reportType = 'said_verification';
    payload.idNumber = cleanId;
  } else {
    payload.reportType = 'document_authentication';
    payload.passportNumber = cleanId;
  }

  let vnResult;
  let vnHttpStatus;
  try {
    const vnRes = await fetch('https://www.verifynow.co.za/api/external/verify', {
      method: 'POST',
      headers: {
        'x-api-key': VERIFYNOW_API_KEY,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    vnHttpStatus = vnRes.status;
    vnResult = await vnRes.json();
    console.log('[verify-identity] VerifyNow raw response:', JSON.stringify(vnResult));

    if (!vnRes.ok) {
      const errMsg = vnResult?.message || vnResult?.error || `VerifyNow error ${vnHttpStatus}`;
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ verified: false, message: errMsg, _debug: vnResult }),
      };
    }
  } catch (err) {
    console.error('[verify-identity] VerifyNow fetch error:', err);
    return {
      statusCode: 502, headers,
      body: JSON.stringify({ error: 'Verification service unavailable. Try again shortly.' }),
    };
  }

  // ── Interpret result ──────────────────────────────────────────────────────
  const verified =
    vnResult.status === 'verified' ||
    vnResult.verified === true ||
    vnResult.result === 'pass' ||
    vnResult.result === 'verified' ||
    (vnResult.data && (vnResult.data.verified === true || vnResult.data.status === 'verified'));

  const reference = vnResult.reference || vnResult.id || vnResult.data?.reference || null;

  if (verified) {
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        verified: true,
        verification_reference: reference,
        verification_date: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateErr) {
      console.error('[verify-identity] profiles update error:', updateErr);
    }

    // Sync to auth metadata so auth.me() reflects it immediately
    await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: { verified: true },
    });
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      verified,
      reference,
      message: verified
        ? 'Identity verified successfully.'
        : (vnResult.message || vnResult.reason || 'Could not verify your identity. Check your details and try again.'),
    }),
  };
};