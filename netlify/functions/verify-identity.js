const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFYNOW_API_KEY = process.env.VERIFYNOW_API_KEY;

// ── SA ID number structural validation ───────────────────────────────────────
// A real South African ID number encodes: birthdate (YYMMDD), a gender
// sequence, a citizenship digit (0 or 1), and a Luhn check digit. This is a
// pure format/structure check — it rejects obviously-fake numbers (like
// "0000000000000") before they ever reach VerifyNow. It does NOT confirm the
// number belongs to the submitter — that's handled below via the name
// cross-check + Face Match against the Home Affairs photo.
function isValidSaIdNumber(id) {
  if (!/^\d{13}$/.test(id)) return false;
  if (/^(\d)\1{12}$/.test(id)) return false; // all-same-digit, e.g. 0000000000000

  const mm = parseInt(id.slice(2, 4), 10);
  const dd = parseInt(id.slice(4, 6), 10);
  const yy = parseInt(id.slice(0, 2), 10);
  if (mm < 1 || mm > 12) return false;
  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
  const validDay = (century) => dd >= 1 && dd <= daysInMonth(century + yy, mm);
  if (!validDay(2000) && !validDay(1900)) return false;

  const citizenship = id[10];
  if (citizenship !== '0' && citizenship !== '1') return false;

  // Luhn checksum — digit 13 is the check digit
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

// ── Name cross-check ──────────────────────────────────────────────────────────
// Compares a document-registered name against the profile's declared
// full_name. Lenient by design — names on record can differ in order/
// middle-name inclusion from what someone typed as their profile name —
// but requires at least one shared surname-like token AND one shared
// first-name-like token. This is what actually stops someone entering a
// stranger's real, valid ID/passport number: the number would check out,
// but the name tied to it won't match their own profile.
function normalizeNameTokens(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function namesLikelyMatch(profileFullName, docFirstNames, docLastName) {
  const profileTokens = normalizeNameTokens(profileFullName);
  const docLastTokens  = normalizeNameTokens(docLastName);
  const docFirstTokens = normalizeNameTokens(docFirstNames);
  if (profileTokens.length === 0 || docLastTokens.length === 0) return false;

  const surnameMatches = docLastTokens.some(t => profileTokens.includes(t));
  const firstNameOverlap = docFirstTokens.length === 0 || docFirstTokens.some(t => profileTokens.includes(t));

  return surnameMatches && firstNameOverlap;
}

// A single "First Last" style full name (as OCR sometimes returns it) split
// into first/last guesses for reuse with namesLikelyMatch above.
function splitFullName(fullName) {
  const tokens = normalizeNameTokens(fullName);
  if (tokens.length === 0) return { first: '', last: '' };
  if (tokens.length === 1) return { first: tokens[0], last: tokens[0] };
  return { first: tokens.slice(0, -1).join(' '), last: tokens[tokens.length - 1] };
}

async function callVerifyNow(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': VERIFYNOW_API_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json };
}

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

  const { idNumber, documentType, frontImageBase64, backImageBase64, selfieImageBase64 } = body;

  if (!documentType) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'documentType is required' }) };
  }
  if (documentType === 'sa_id') {
    if (!idNumber) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'idNumber is required for SA ID verification' }) };
    }
    if (!selfieImageBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'A selfie photo is required for SA ID verification' }) };
    }
  }
  if (documentType === 'passport') {
    if (!idNumber) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'idNumber (passport number) is required' }) };
    }
    if (!frontImageBase64 || !backImageBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Both passport images are required' }) };
    }
    if (!selfieImageBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'A selfie photo is required for passport verification' }) };
    }
  }

  // ── Lock check — once id_verified is true, no further identity verification ──
  // attempts (SA ID or passport) are allowed, successful or not.
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id_verified, licence_verified, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if ((documentType === 'sa_id' || documentType === 'passport') && existingProfile?.id_verified) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        alreadyVerified: true,
        message: 'Your identity is already verified. This cannot be re-submitted.',
      }),
    };
  }

  const cleanId = idNumber ? idNumber.trim().toUpperCase() : '';

  // ── Structural validation (SA ID only — passport numbers have a different, non-checksummed format) ──
  if (documentType === 'sa_id' && !isValidSaIdNumber(cleanId)) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        verified: false,
        message: 'That does not look like a valid South African ID number. Please check the digits and try again.',
      }),
    };
  }

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

  let verified = false;
  let message = '';
  let reference = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // SA ID path — said_verification (1cr) → name cross-check (free) →
  // Face Match against the Home Affairs photo (10cr, only if name matched)
  // ═══════════════════════════════════════════════════════════════════════════
  if (documentType === 'sa_id') {
    let vnResult;
    try {
      const { ok, status, json } = await callVerifyNow('https://www.verifynow.co.za/api/external/verify', {
        mode: 'production',
        reportType: 'said_verification',
        idNumber: cleanId,
      });
      vnResult = json;
      console.log('[verify-identity] said_verification raw response:', JSON.stringify(vnResult));
      if (!ok) {
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ verified: false, message: vnResult?.message || vnResult?.error || `VerifyNow error ${status}`, _debug: vnResult }),
        };
      }
    } catch (err) {
      console.error('[verify-identity] said_verification fetch error:', err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Verification service unavailable. Try again shortly.' }) };
    }

    const reportResult = vnResult.results?.said_verification;
    if (reportResult && (reportResult.Status === 'Success' || reportResult.realTimeResults?.Status === 'ID Number Valid')) {
      verified = true;
      message = 'Identity verified successfully.';
    } else {
      message = reportResult?.realTimeResults?.Status || reportResult?.message || 'Verification failed.';
    }
    reference = vnResult.requestId || vnResult.reference || null;

    if (verified) {
      const v = reportResult?.realTimeResults?.Verification || {};
      if (!namesLikelyMatch(existingProfile?.full_name, v.Firstnames, v.Lastname)) {
        verified = false;
        message = 'The name on this ID number does not match your profile name. Please make sure you entered your own ID number, or update your profile name to match your ID.';
      } else {
        try {
          const { ok, json: fmResult } = await callVerifyNow('https://www.verifynow.co.za/api/external/facematch', {
            bundle: 'facematch',
            mode: 'production',
            selfie_image_base64: selfieImageBase64.includes(',') ? selfieImageBase64.split(',')[1] : selfieImageBase64,
            id_number: cleanId,
          });
          console.log('[verify-identity] Face Match (Home Affairs) raw response:', JSON.stringify(fmResult));
          const fmStatus = fmResult?.results?.face_match?.status;
          if (!ok || fmStatus !== 'Approved') {
            verified = false;
            message = fmStatus
              ? `Selfie did not match your ID photo (result: ${fmStatus}). Please try again with a clear, well-lit selfie.`
              : (fmResult?.message || fmResult?.error || 'Could not verify your selfie against your ID photo. Please try again.');
          }
        } catch (err) {
          console.error('[verify-identity] Face Match fetch error:', err);
          verified = false;
          message = 'Selfie verification service unavailable. Please try again shortly.';
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Passport path — OCR via /id-document-verify (6cr) → name + document-number
  // cross-check (free) → Face Match Standard vs the uploaded passport photo (1cr)
  //
  // NOTE: this replaces a previous call to reportType 'document_authentication'
  // on /verify, which does not appear in VerifyNow's documented reportTypes.
  // /id-document-verify with bundle 'id_document_verification' is the
  // documented OCR endpoint — the same one already used for driver's licence
  // verification.
  // ═══════════════════════════════════════════════════════════════════════════
  if (documentType === 'passport') {
    const toRawBase64 = b64 => (b64.includes(',') ? b64.split(',')[1] : b64);
    let vnResult;
    try {
      const { ok, status, json } = await callVerifyNow('https://www.verifynow.co.za/api/external/id-document-verify', {
        bundle: 'id_document_verification',
        mode: 'production',
        front_image_base64: toRawBase64(frontImageBase64),
        back_image_base64: toRawBase64(backImageBase64),
        document_type: 'Passport',
      });
      vnResult = json;
      console.log('[verify-identity] id-document-verify raw response:', JSON.stringify(vnResult));
      if (!ok) {
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ verified: false, message: vnResult?.message || vnResult?.error || `VerifyNow error ${status}`, _debug: vnResult }),
        };
      }
    } catch (err) {
      console.error('[verify-identity] id-document-verify fetch error:', err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Verification service unavailable. Try again shortly.' }) };
    }

    const docResult = vnResult.results?.id_verification;
    reference = vnResult.requestId || vnResult.reference || null;

    if (docResult && (docResult.status === 'Approved' || docResult.status === 'success')) {
      verified = true;
      message = 'Passport verified successfully.';
    } else {
      verified = false;
      message = docResult?.message || 'Could not read your passport. Please retake clear, well-lit photos and try again.';
    }

    if (verified) {
      const { first, last } = docResult.first_name && docResult.last_name
        ? { first: docResult.first_name, last: docResult.last_name }
        : splitFullName(docResult.full_name);

      const nameMatches = namesLikelyMatch(existingProfile?.full_name, first, last);
      const docNumber = (docResult.document_number || '').replace(/\s+/g, '').toUpperCase();
      const numberMatches = !docNumber || docNumber === cleanId;

      if (!nameMatches) {
        verified = false;
        message = 'The name on this passport does not match your profile name. Please make sure this is your own passport, or update your profile name to match it.';
      } else if (!numberMatches) {
        verified = false;
        message = 'The passport number you entered does not match the number on the uploaded photos. Please check and try again.';
      } else {
        try {
          const { ok, json: fmResult } = await callVerifyNow('https://www.verifynow.co.za/api/external/facematch', {
            bundle: 'facematch_standard',
            mode: 'production',
            selfie_image_base64: toRawBase64(selfieImageBase64),
            reference_image_base64: toRawBase64(frontImageBase64),
          });
          console.log('[verify-identity] Face Match (Standard) raw response:', JSON.stringify(fmResult));
          const fmStatus = fmResult?.results?.face_match?.status;
          if (!ok || fmStatus !== 'Approved') {
            verified = false;
            message = fmStatus
              ? `Selfie did not match your passport photo (result: ${fmStatus}). Please try again with a clear, well-lit selfie.`
              : (fmResult?.message || fmResult?.error || 'Could not verify your selfie against your passport photo. Please try again.');
          }
        } catch (err) {
          console.error('[verify-identity] Face Match fetch error:', err);
          verified = false;
          message = 'Selfie verification service unavailable. Please try again shortly.';
        }
      }
    }
  }

  // ── Apply result ─────────────────────────────────────────────────────────
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
      const badge = existingProfile?.licence_verified ? 'fully_verified' : 'id_verified';
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
