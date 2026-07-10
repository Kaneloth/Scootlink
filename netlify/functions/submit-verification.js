/**
 * Netlify Function: submit-verification
 *
 * Replaces verify-identity.js and verify-licence.js entirely — no more
 * VerifyNow API calls. Validates what can still be validated server-side
 * (SA ID structural format, blacklist, payment), uploads the submitted
 * documents to Supabase Storage, and creates a 'pending' row in
 * identity_verification_submissions for an admin to review manually.
 *
 * POST body: {
 *   serviceType: 'sa_id' | 'passport' | 'licence',
 *   idNumber: string,
 *   frontImageBase64: string,
 *   backImageBase64: string,
 *   selfieImageBase64: string,
 * }
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Keep in sync with PRICES in VerificationPanel.jsx and SERVICES in
// payfast-initiate-verification.js — this is the server-side source of
// truth checked against what was actually paid.
const PRICES = { sa_id: 25, passport: 25, licence: 25 };

// ── SA ID number structural validation (unchanged from the old verify-identity.js) ──
// Encodes birthdate/gender/citizenship/Luhn check digit. Pure format check —
// rejects obviously-fake numbers (e.g. "0000000000000") before they ever
// reach an admin. Does NOT confirm the number belongs to the submitter —
// that's now the admin's job, visually comparing the uploaded document.
function isValidSaIdNumber(id) {
  if (!/^\d{13}$/.test(id)) return false;
  if (/^(\d)\1{12}$/.test(id)) return false;

  const mm = parseInt(id.slice(2, 4), 10);
  const dd = parseInt(id.slice(4, 6), 10);
  const yy = parseInt(id.slice(0, 2), 10);
  if (mm < 1 || mm > 12) return false;
  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
  const validDay = (century) => dd >= 1 && dd <= daysInMonth(century + yy, mm);
  if (!validDay(2000) && !validDay(1900)) return false;

  const citizenship = id[10];
  if (citizenship !== '0' && citizenship !== '1') return false;

  const digits = id.split('').map(Number);
  let oddSum = 0;
  for (let i = 0; i < 12; i += 2) oddSum += digits[i];
  let evenConcat = '';
  for (let i = 1; i < 12; i += 2) evenConcat += digits[i];
  const evenDoubled = String(parseInt(evenConcat, 10) * 2);
  const evenSum = evenDoubled.split('').reduce((sum, d) => sum + Number(d), 0);
  const checkDigit = (10 - ((oddSum + evenSum) % 10)) % 10;

  return checkDigit === digits[12];
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

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { serviceType, idNumber, frontImageBase64, backImageBase64, selfieImageBase64 } = body;

  if (!['sa_id', 'passport', 'licence'].includes(serviceType)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid serviceType' }) };
  }
  if (!idNumber?.trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'A document number is required' }) };
  }
  if (!frontImageBase64 || !backImageBase64) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Both front and back document photos are required' }) };
  }
  if (!selfieImageBase64) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'A selfie photo is required' }) };
  }

  const cleanId = idNumber.trim().toUpperCase();

  // ── Already verified — no re-submission ──────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('id_verified, licence_verified, full_name')
    .eq('id', user.id)
    .maybeSingle();

  const alreadyVerifiedField = serviceType === 'licence' ? 'licence_verified' : 'id_verified';
  if (profile?.[alreadyVerifiedField]) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ pending: false, alreadyVerified: true, message: 'This is already verified and cannot be re-submitted.' }),
    };
  }

  // ── Already has a pending submission — no duplicates ─────────────────────
  const { data: existingPending } = await supabase
    .from('identity_verification_submissions')
    .select('id')
    .eq('user_id', user.id)
    .eq('service_type', serviceType)
    .eq('verification_status', 'pending')
    .maybeSingle();

  if (existingPending) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ pending: true, alreadyPending: true, message: 'You already have a submission awaiting review.' }),
    };
  }

  // ── SA ID structural validation ──────────────────────────────────────────
  if (serviceType === 'sa_id' && !isValidSaIdNumber(cleanId)) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ pending: false, message: 'That does not look like a valid South African ID number. Please check the digits and try again.' }),
    };
  }

  // ── Blacklist check (SA ID / passport only — licence numbers were never tracked here) ──
  if (serviceType !== 'licence') {
    const { data: banned } = await supabase
      .from('blacklisted_id_numbers')
      .select('id_number')
      .eq('id_number', cleanId)
      .maybeSingle();
    if (banned) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ pending: false, message: 'This ID/passport has been flagged. Contact help@skootlink.co.za to resolve this.' }),
      };
    }
  }

  // ── Payment check ─────────────────────────────────────────────────────────
  const { data: payment } = await supabase
    .from('verification_payments')
    .select('id, amount')
    .eq('user_id', user.id)
    .eq('service_type', serviceType)
    .eq('status', 'paid')
    .eq('used', false)
    .maybeSingle();

  const requiredAmount = PRICES[serviceType];
  if (!payment || (payment.amount != null && Number(payment.amount) < requiredAmount)) {
    return { statusCode: 402, headers, body: JSON.stringify({ pending: false, message: 'Payment required before submitting.' }) };
  }

  // ── Upload documents ──────────────────────────────────────────────────────
  const uploadImage = async (b64, filename) => {
    const buffer = Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64');
    const path = `${user.id}/${serviceType}/${Date.now()}_${filename}`;
    const { error } = await supabase.storage.from('identity-documents').upload(path, buffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) throw error;
    return path;
  };

  let frontPath, backPath, selfiePath;
  try {
    [frontPath, backPath, selfiePath] = await Promise.all([
      uploadImage(frontImageBase64, 'front.jpg'),
      uploadImage(backImageBase64, 'back.jpg'),
      uploadImage(selfieImageBase64, 'selfie.jpg'),
    ]);
  } catch (err) {
    console.error('[submit-verification] Upload failed:', err.message);
    // Our side failed before consuming the payment — client's catch block
    // handles this the same way the old verify-identity.js did: a credit refund.
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not upload your documents. Please try again.' }) };
  }

  // ── Create the pending submission ────────────────────────────────────────
  const { error: insertErr } = await supabase.from('identity_verification_submissions').insert({
    user_id: user.id,
    service_type: serviceType,
    id_or_licence_number: cleanId,
    document_front_path: frontPath,
    document_back_path: backPath,
    selfie_path: selfiePath,
    verification_status: 'pending',
  });

  if (insertErr) {
    console.error('[submit-verification] Insert failed:', insertErr.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not save your submission. Please try again.' }) };
  }

  // Consume the payment now that the submission is genuinely in the queue.
  await supabase.from('verification_payments').update({ used: true }).eq('id', payment.id);

  // Mirror the existing license_pending flag for licence submissions, since
  // some existing UI/logic already reads it.
  if (serviceType === 'licence') {
    await supabase.from('profiles').update({ license_pending: true }).eq('id', user.id);
  }

  console.log(`[submit-verification] Submitted: user=${user.id} service=${serviceType}`);
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ pending: true, message: 'Documents submitted for review. You\'ll be notified once verified.' }),
  };
};
