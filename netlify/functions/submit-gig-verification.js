/**
 * Netlify Function: submit-gig-verification
 * Driver submits documents for Delivery-Ready or Passenger-Ready tier.
 * Follows submit-verification.js's real pattern: client compresses images
 * to base64 and sends as JSON, this function does the actual Storage
 * upload + row write server-side (service role) — not a direct client
 * storage.upload() call.
 *
 * Free verification (no payment gate) — per the decided monetization
 * model (§5.11): Gig-Ready is free, cost recovered via gig commission.
 *
 * POST body:
 *   {
 *     tier: 'delivery_ready' | 'passenger_ready',
 *     licenseImageBase64, idImageBase64, selfieImageBase64,
 *     pdpImageBase64?, policeClearanceImageBase64?, pdpExpiryDate?   // required if tier = passenger_ready
 *   }
 *
 * Already-approved drivers (migration 016):
 *   - asking for passenger_ready again = UPGRADE (Delivery-Ready) or PDP
 *     RENEWAL (Passenger-Ready): only pdp + police clearance + pdpExpiryDate
 *     are needed, stored in upgrade_* columns and reviewed while the driver
 *     keeps their current tier;
 *   - asking for delivery_ready = already covered, nothing to do.
 * Auth: Bearer token — driver_id derived server-side, never trusted from client (§3.2)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const BUCKET_NAME = 'gig-verification-documents';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function base64ToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  return Buffer.from(base64, 'base64');
}

async function uploadDoc(driverId, docType, base64) {
  const path = `${driverId}/${docType}-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, base64ToBuffer(base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Failed to upload ${docType}: ${error.message}`);
  return path;
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

  const {
    tier, licenseImageBase64, idImageBase64, selfieImageBase64,
    pdpImageBase64, policeClearanceImageBase64, pdpExpiryDate,
  } = body;

  if (!['delivery_ready', 'passenger_ready'].includes(tier)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "tier must be 'delivery_ready' or 'passenger_ready'" }) };
  }
  if (tier === 'passenger_ready') {
    if (!pdpImageBase64 || !policeClearanceImageBase64 || !pdpExpiryDate) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'PDP, police clearance and the PDP expiry date are required for Passenger-Ready' }) };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pdpExpiryDate) || new Date(pdpExpiryDate) < new Date(new Date().toDateString())) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'The PDP expiry date must be a valid date that has not passed' }) };
    }
  }

  // ── Verify JWT, derive driver_id server-side ──────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Missing Authorization header' }) };
  }
  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    console.warn('[submit-gig-verification] Invalid session:', userErr?.message);
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  const driverId = userData.user.id;

  try {
    // ── Check existing submission ───────────────────────────────────────────
    const { data: existing, error: existingErr } = await supabase
      .from('driver_gig_verification')
      .select('id, tier, status, upgrade_status')
      .eq('driver_id', driverId)
      .maybeSingle();
    if (existingErr) throw existingErr;

    if (existing?.status === 'pending' || existing?.upgrade_status === 'pending') {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ alreadyPending: true, message: 'Your previous submission is still under review.' }) };
    }
    if (existing?.status === 'approved' && tier === 'delivery_ready') {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ alreadyVerified: true, message: "You're already approved for deliveries." }) };
    }

    // ── Upgrade / PDP renewal for an approved driver ─────────────────────────
    if (existing?.status === 'approved' && tier === 'passenger_ready') {
      const [upPdp, upPolice] = await Promise.all([
        uploadDoc(driverId, 'pdp', pdpImageBase64),
        uploadDoc(driverId, 'police-clearance', policeClearanceImageBase64),
      ]);
      const { error: upErr } = await supabase
        .from('driver_gig_verification')
        .update({
          upgrade_status: 'pending',
          upgrade_pdp_url: upPdp,
          upgrade_police_clearance_url: upPolice,
          upgrade_pdp_expiry_date: pdpExpiryDate,
          upgrade_rejection_reason: null,
          upgrade_requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('driver_id', driverId)
        .eq('status', 'approved');
      if (upErr) throw upErr;
      const what = existing.tier === 'passenger_ready' ? 'PDP renewal' : 'Passenger-Ready upgrade';
      console.log(`[submit-gig-verification] ${what} submitted: driver=${driverId}`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ upgradePending: true, message: `${what} submitted — you keep your current status while it's reviewed.` }) };
    }

    // ── New submission: licence, ID and selfie are required ──────────────────
    if (!licenseImageBase64 || !idImageBase64 || !selfieImageBase64) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'License, ID, and selfie images are required' }) };
    }

    // ── Upload documents ─────────────────────────────────────────────────────
    const [licensePath, idPath, selfiePath] = await Promise.all([
      uploadDoc(driverId, 'license', licenseImageBase64),
      uploadDoc(driverId, 'id', idImageBase64),
      uploadDoc(driverId, 'selfie', selfieImageBase64),
    ]);
    let pdpPath = null;
    let policeClearancePath = null;
    if (tier === 'passenger_ready') {
      [pdpPath, policeClearancePath] = await Promise.all([
        uploadDoc(driverId, 'pdp', pdpImageBase64),
        uploadDoc(driverId, 'police-clearance', policeClearanceImageBase64),
      ]);
    }

    // ── Upsert submission row ────────────────────────────────────────────────
    const { error: upsertErr } = await supabase
      .from('driver_gig_verification')
      .upsert({
        driver_id: driverId,
        tier,
        drivers_license_url: licensePath,
        id_document_url: idPath,
        selfie_url: selfiePath,
        pdp_url: pdpPath,
        police_clearance_url: policeClearancePath,
        pdp_expiry_date: tier === 'passenger_ready' ? pdpExpiryDate : null,
        upgrade_status: null,
        status: 'pending',
        rejection_reason: null,
        verified_at: null,
        verified_by: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' });

    if (upsertErr) throw upsertErr;

    console.log(`[submit-gig-verification] Submitted: driver=${driverId} tier=${tier}`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ pending: true, message: 'Submitted — awaiting review.' }) };
  } catch (err) {
    console.error('[submit-gig-verification] Error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message || 'Submission failed' }) };
  }
};
