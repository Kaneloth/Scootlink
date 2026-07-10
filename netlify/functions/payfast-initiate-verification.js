/**
 * Netlify Function: payfast-initiate-verification
 * Builds a PayFast payment form for a verification service purchase.
 * POST body: { service_type: 'sa_id' | 'passport' | 'licence' }
 *
 * Place at: netlify/functions/payfast-initiate-verification.js
 */
import { createClient } from '@supabase/supabase-js';
import { generateSignature, PAYFAST_PROCESS_URL, SITE_URL } from './lib/payfast.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID;
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PASSPHRASE   = process.env.PAYFAST_PASSPHRASE || '';

// Keep in sync with PRICES in VerificationPanel.jsx — this is the server-side
// source of truth for what PayFast actually charges, so a mismatch here means
// the payment modal shows one price while PayFast (and verification_payments.amount)
// silently charges another.
const SERVICES = {
  sa_id:    { label: 'RSA ID Verification',          price: 49 },
  passport: { label: 'Passport Verification',         price: 35 },
  licence:  { label: "Driver's Licence Verification", price: 35 },
};

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!MERCHANT_ID || !MERCHANT_KEY) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Payments not configured.' }) };
  }

  const jwt = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!jwt) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid session' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const service = SERVICES[body.service_type];
  if (!service) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Unknown service "${body.service_type}"` }) };
  }

  const m_payment_id = `skoot_verif_${body.service_type}_${user.id.slice(0, 8)}_${Date.now()}`;
  const firstName = (user.user_metadata?.full_name || 'Skootlink').split(' ')[0];

  // See payfast-initiate.js for why this always uses the https bridge page
  // instead of branching on is_native.
  // See payfast-initiate.js for why native uses a real server-side redirect
  // (payment-redirect function) instead of the old client-side JS bridge page.
  const isNative = body.is_native === true;
  const return_url = isNative
    ? `${SITE_URL}/.netlify/functions/payment-redirect?status=success&category=verification&service=${body.service_type}`
    : `${SITE_URL}/profile?verif_payment=success&service=${body.service_type}`;
  const cancel_url = isNative
    ? `${SITE_URL}/.netlify/functions/payment-redirect?status=cancelled&category=verification`
    : `${SITE_URL}/profile?verif_payment=cancelled`;

  console.log(`[payfast-initiate-verification] is_native=${isNative} return_url=${return_url} cancel_url=${cancel_url}`);

  const fields = {
    merchant_id:      MERCHANT_ID,
    merchant_key:     MERCHANT_KEY,
    return_url,
    cancel_url,
    notify_url:       `https://hkdk.events/ej5pgh02nhm47r`,
    name_first:       firstName,
    email_address:    user.email,
    m_payment_id,
    amount:           service.price.toFixed(2),
    item_name:        service.label,
    item_description: `Skootlink ${service.label}`,
    custom_str1:      user.id,
    custom_str2:      body.service_type,
    custom_str3:      'verification',
    custom_str4:      'skootlink', // app tag — see payfast-initiate.js note
  };

  const signature = generateSignature(fields, PASSPHRASE);

  // Pre-create a pending payment record so the webhook can mark it as paid
  try {
    await supabase.from('verification_payments').insert({
      user_id:      user.id,
      service_type: body.service_type,
      amount:       service.price,
      m_payment_id,
      status:       'pending',
      used:         false,
    });
  } catch (err) {
    console.error('[payfast-initiate-verification] pre-insert failed:', err);
  }

  console.log(`[payfast-initiate-verification] user=${user.id} service=${body.service_type} m_payment_id=${m_payment_id}`);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      action_url: PAYFAST_PROCESS_URL,
      fields: { ...fields, signature },
    }),
  };
};