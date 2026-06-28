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

  const { idNumber, documentType, frontImageBase64, backImageBase64 } = body;

  // SA ID requires idNumber; passport requires idNumber + both images
  if (!documentType) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'documentType is required' }) };
  }
  if (documentType === 'sa_id' && !idNumber) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'idNumber is required for SA ID verification' }) };
  }
  if (documentType === 'passport') {
    if (!idNumber) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'idNumber (passport number) is required' }) };
    }
    if (!frontImageBase64 || !backImageBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Both passport images are required' }) };
    }
  }

  const cleanId = idNumber ? idNumber.trim().toUpperCase() : '';

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
    // Include images if provided (required by VerifyNow for passport)
    if (frontImageBase64 && backImageBase64) {
      const toBuffer = b64 => Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64').toString('base64');
      payload.frontImageBase64 = toBuffer(frontImageBase64);
      payload.backImageBase64  = toBuffer(backImageBase64);
    }
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
  // Handle nested results (e.g., said_verification) and fall back to other fields.
  let verified = false;
  let message = '';

  // Determine which report type key to look for in the results object
  const reportKey = documentType === 'sa_id' ? 'said_verification' : 'document_authentication';
  const reportResult = vnResult.results?.[reportKey];

  if (reportResult) {
    // SA ID: check Status and realTimeResults.Status
    if (
      reportResult.Status === 'Success' ||
      reportResult.realTimeResults?.Status === 'ID Number Valid'
    ) {
      verified = true;
      message = 'Identity verified successfully.';
    } else {
      // Failure case — extract a meaningful message if available
      message =
        reportResult.realTimeResults?.Status ||
        reportResult.message ||
        'Verification failed.';
    }
  } else if (vnResult.success === true) {
    // Some report types (like document authentication) might only have success flag
    verified = true;
    message = 'Identity verified successfully.';
  } else {
    // Fallback: check top‑level or data fields for older API shapes
    verified =
      vnResult.status === 'verified' ||
      vnResult.verified === true ||
      vnResult.result === 'pass' ||
      vnResult.result === 'verified' ||
      (vnResult.data && (vnResult.data.verified === true || vnResult.data.status === 'verified'));
    message = verified
      ? 'Identity verified successfully.'
      : (vnResult.message || vnResult.reason || 'Could not verify your identity. Check your details and try again.');
  }

  const reference = vnResult.requestId || vnResult.reference || vnResult.id || vnResult.data?.reference || null;

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

    // ── Badge columns (silently skipped if migration hasn't been run yet) ──
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('licence_verified')
        .eq('id', user.id)
        .single();
      const badge = profile?.licence_verified ? 'fully_verified' : 'id_verified';
      await supabase.from('profiles').update({
        id_verified:    true,
        id_verified_at: new Date().toISOString(),
        verification_badge: badge,
      }).eq('id', user.id);
    } catch (e) {
      console.warn('[verify-identity] Badge update skipped:', e.message);
    }

    // Sync to auth metadata so auth.me() reflects it immediately
    await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: { verified: true },
    });
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ verified, reference, message }),
  };
};