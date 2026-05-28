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

  const { licenceNumber, yearIssued } = body;
  if (!licenceNumber || !yearIssued) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'licenceNumber and yearIssued are required' }) };
  }

  // ── Format validation ─────────────────────────────────────────────────
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

  // ── Call VerifyNow ────────────────────────────────────────────────────
  // The correct bundle/reportType for driving licence is account‑specific.
  // Check your VerifyNow dashboard or ask support for the exact name.
  // Common names: 'driving_licence_verification', 'driver_licence', 'licence_verification'
  const licenceBundle = 'driving_licence_verification'; // <-- replace with your bundle name
  const payload = {
    reportType: licenceBundle,
    licenceNumber: clean,
    yearIssued: year,
  };
  if (USE_SANDBOX) payload.mode = 'sandbox'; // remove for live

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

    const vnResult = await vnRes.json();
    console.log('[verify-licence] VerifyNow response:', JSON.stringify(vnResult));

    // If the API returns an error about the bundle name, fall back to manual review.
    if (!vnRes.ok || vnResult.error || vnResult.message?.includes('bundle')) {
      console.warn('[verify-licence] Bundle not available – saving as pending review.');
      await saveLicenceToProfile(supabase, user.id, clean, year, false, 'pending_manual_review');
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          verified: false,
          pending: true,
          message: 'Licence details saved — pending manual review.',
        }),
      };
    }

    // ── Interpret result ────────────────────────────────────────────────
    const isVerified =
      vnResult.status === 'verified' ||
      vnResult.verified === true ||
      vnResult.result === 'pass' ||
      (vnResult.data && vnResult.data.verified === true);

    if (isVerified) {
      await saveLicenceToProfile(supabase, user.id, clean, year, true, null);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ verified: true, message: 'Driving licence verified.' }),
      };
    } else {
      const message = vnResult.message || vnResult.reason || 'Licence could not be verified.';
      await saveLicenceToProfile(supabase, user.id, clean, year, false, null);
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ verified: false, message }),
      };
    }
  } catch (err) {
    console.error('[verify-licence] Fetch error:', err);
    // Network error – still save the data but mark as pending
    await saveLicenceToProfile(supabase, user.id, clean, year, false, 'pending_review');
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        pending: true,
        message: 'Verification service temporarily unavailable. Your details have been saved.',
      }),
    };
  }
};

// ── Helper: update profiles table ───────────────────────────────────────────
async function saveLicenceToProfile(supabase, userId, licenceNumber, year, verified, pending) {
  const update = {
    license_number: licenceNumber,
    license_year:   year,
  };

  if (verified) {
    const now = new Date().toISOString();

    // ── Determine badge level ──────────────────────────────────────────
    // If the user already has their identity verified, they earn Fully Verified.
    const { data: profile } = await supabase
      .from('profiles')
      .select('id_verified')
      .eq('id', userId)
      .single();

    const badge = profile?.id_verified ? 'fully_verified' : 'id_verified';

    update.licence_verified     = true;   // new badge column (British spelling matches frontend)
    update.licence_verified_at  = now;
    update.license_verified     = true;   // legacy column — keep in sync
    update.license_verified_at  = now;
    update.license_pending      = false;
    update.verification_badge   = badge;
  } else if (pending) {
    update.license_pending   = true;
    update.license_verified  = false;
    update.licence_verified  = false;
  }

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (error) {
    console.error('[verify-licence] Failed to update profile:', error);
  }
}
