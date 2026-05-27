const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY = process.env.VERIFYNOW_API_KEY;

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

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { licenceNumber, yearIssued } = body;
  if (!licenceNumber || !yearIssued) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'licenceNumber and yearIssued are required' }) };
  }

  // ── Format validation ─────────────────────────────────────────────────────
  const clean = licenceNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(clean)) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message: 'Licence number format is invalid.' }),
    };
  }

  const year = parseInt(yearIssued);
  const currentYear = new Date().getFullYear();
  if (isNaN(year) || year < 1960 || year > currentYear) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message: 'Issue year is invalid.' }),
    };
  }

  // ── Call VerifyNow for driving licence check ──────────────────────────────
  // Check your VerifyNow account for the exact driving licence report type name.
  // Possible names: 'driving_licence_verification', 'licence_verification', 'driver_licence'
  let vnVerified = false;
  let pendingReview = false;
  let vnMessage = '';

  try {
    const vnRes = await fetch('https://www.verifynow.co.za/api/external/verify', {
      method: 'POST',
      headers: {
        'x-api-key': VERIFYNOW_API_KEY,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        reportType: 'driving_licence_verification',
        licenceNumber: clean,
        yearIssued: year,
        mode: 'sandbox', // ← remove for production
      }),
    });

    const vnResult = await vnRes.json();
    console.log('[verify-licence] VerifyNow raw response:', JSON.stringify(vnResult));

    if (!vnRes.ok) {
      // VerifyNow rejected the request (e.g. bundle not enabled on account).
      // Fall back to pending admin review — still allow the user to proceed.
      console.warn('[verify-licence] VerifyNow error — falling back to pending review:', vnResult);
      pendingReview = true;
      vnVerified = true; // allow user to continue, but flag as pending
      vnMessage = 'Licence recorded — pending admin verification.';
    } else {
      vnVerified =
        vnResult.status === 'verified' ||
        vnResult.verified === true ||
        vnResult.result === 'pass' ||
        vnResult.result === 'verified' ||
        (vnResult.data && (vnResult.data.verified === true || vnResult.data.status === 'verified'));
      vnMessage = vnVerified
        ? 'Driving licence verified successfully.'
        : (vnResult.message || vnResult.reason || 'Could not verify your licence. Check the number and try again.');
    }
  } catch (err) {
    // Network error calling VerifyNow — fall back to pending review
    console.error('[verify-licence] VerifyNow fetch error:', err);
    pendingReview = true;
    vnVerified = true;
    vnMessage = 'Licence recorded — pending admin verification.';
  }

  if (!vnVerified) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message: vnMessage }),
    };
  }

  // ── Save to profiles ──────────────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({
      license_number: clean,
      license_year: year,
      ...(pendingReview ? {} : { license_verified: true }),
    })
    .eq('id', user.id);

  if (updateErr) {
    console.error('[verify-licence] profiles update error:', updateErr);
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ verified: true, pending: pendingReview, message: vnMessage }),
  };
};
