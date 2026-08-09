/**
 * Netlify Function: submit-vehicle-ride-ready
 * Owner submits a roadworthy certificate to get a specific vehicle
 * certified Ride-Ready. Same base64-JSON pattern as submit-verification.js
 * and submit-gig-verification.js.
 *
 * Explicit ownership check below — this is the SECURITY DEFINER-equivalent
 * authorization a service-role Netlify function must do itself, since
 * there's no RLS to lean on here (§3.2 pattern: never trust a
 * client-supplied ID, verify server-side).
 *
 * POST body: { vehicleId, certificateImageBase64, expiryDate, testingStation }
 * Auth: Bearer token
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const BUCKET_NAME = 'vehicle-ride-ready-documents';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function base64ToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  return Buffer.from(base64, 'base64');
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: 'Invalid JSON' }; }

  const { vehicleId, certificateImageBase64, expiryDate, testingStation } = body;

  if (!vehicleId || !certificateImageBase64 || !expiryDate || !testingStation?.trim()) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'vehicleId, certificateImageBase64, expiryDate, and testingStation are all required' }) };
  }
  if (new Date(expiryDate) < new Date()) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Certificate expiry date is in the past — please upload a currently-valid certificate' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Missing Authorization header' }) };
  }
  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    console.warn('[submit-vehicle-ride-ready] Invalid session:', userErr?.message);
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  const ownerId = userData.user.id;

  try {
    // ── Ownership check — the critical authorization step ────────────────────
    const { data: vehicle, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('id, owner_id, ride_ready_status')
      .eq('id', vehicleId)
      .maybeSingle();
    if (vehicleErr) throw vehicleErr;
    if (!vehicle) {
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Vehicle not found' }) };
    }
    if (vehicle.owner_id !== ownerId) {
      console.warn(`[submit-vehicle-ride-ready] Ownership mismatch: user=${ownerId} tried vehicle=${vehicleId} owned by=${vehicle.owner_id}`);
      return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'You do not own this vehicle' }) };
    }
    if (vehicle.ride_ready_status === 'pending') {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ alreadyPending: true, message: 'A certificate for this vehicle is already under review.' }) };
    }

    // ── Upload certificate ────────────────────────────────────────────────────
    const path = `${ownerId}/${vehicleId}-${Date.now()}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, base64ToBuffer(certificateImageBase64), { contentType: 'image/jpeg', upsert: false });
    if (uploadErr) throw new Error(`Failed to upload certificate: ${uploadErr.message}`);

    // ── Update vehicle row ─────────────────────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('vehicles')
      .update({
        roadworthy_certificate_url: path,
        roadworthy_expiry_date: expiryDate,
        roadworthy_testing_station: testingStation.trim(),
        ride_ready_status: 'pending',
        ride_ready_rejection_reason: null,
        ride_ready_verified_at: null,
        ride_ready_verified_by: null,
      })
      .eq('id', vehicleId);
    if (updateErr) throw updateErr;

    console.log(`[submit-vehicle-ride-ready] Submitted: vehicle=${vehicleId} owner=${ownerId}`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ pending: true, message: 'Submitted — awaiting review.' }) };
  } catch (err) {
    console.error('[submit-vehicle-ride-ready] Error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || 'Submission failed' }) };
  }
};
