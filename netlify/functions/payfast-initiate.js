/**
 * Netlify Function: payfast-initiate
 * Builds a signed PayFast payment form for a credit package purchase.
 * POST body: { package_id: 'starter' | 'standard' | 'pro' | 'business' }
 *
 * return_url / cancel_url always point at the bridge page
 * (public/payment-callback.html) regardless of platform.  The bridge page
 * forwards every query param into a co.za.skootlink.app:// deep link, which
 * App.jsx's appUrlOpen listener catches and dispatches as a
 * 'skootlink:payment-result' window event.  This is the only approach that
 * works reliably: PayFast's payment engine rejects non-https return URLs, so
 * a direct co.za.skootlink.app:// return_url is never sent to PayFast.
 */
import { createClient } from '@supabase/supabase-js';
import { generateSignature, PAYFAST_PROCESS_URL, SITE_URL } from './lib/payfast.js';
import { PACKAGES } from './lib/packages.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID;
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PASSPHRASE   = process.env.PAYFAST_PASSPHRASE || '';

// Required so the native app (running from a different origin than
// skootlink.co.za) is allowed to call this function at all.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  if (!MERCHANT_ID || !MERCHANT_KEY) {
    console.error('[payfast-initiate] Missing PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY');
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payments not configured.' }) };
  }

  const jwt = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!jwt) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid session' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS_HEADERS, body: 'Invalid JSON' }; }

  const pkg = PACKAGES[body.package_id];
  if (!pkg) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Unknown package "${body.package_id}"` }) };
  }

  const m_payment_id = `skoot_${user.id.slice(0, 8)}_${Date.now()}`;
  const firstName = (user.user_metadata?.full_name || 'Skootlink').split(' ')[0];

  // Always route through the bridge page (public/payment-callback.html).
  // The bridge page forwards every query param directly into the deep link:
  //   co.za.skootlink.app://payment-result?status=success&category=credits&package=starter
  // App.jsx's appUrlOpen listener picks that up and dispatches the result
  // as a window event.  The category + package params are mandatory — without
  // them Credits.jsx silently ignores the result.
  const return_url = `${SITE_URL}/payment-callback?status=success&category=credits&package=${body.package_id}`;
  const cancel_url = `${SITE_URL}/payment-callback?status=cancelled&category=credits&package=${body.package_id}`;

  console.log(`[payfast-initiate] return_url=${return_url} cancel_url=${cancel_url}`);

  const fields = {
    merchant_id:      MERCHANT_ID,
    merchant_key:     MERCHANT_KEY,
    return_url,
    cancel_url,
    notify_url:       `https://hkdk.events/ej5pgh02nhm47r`,
    name_first:       firstName,
    email_address:    user.email,
    m_payment_id,
    amount:           pkg.price_zar.toFixed(2),
    item_name:        pkg.label,
    item_description: `${pkg.credits} Skootlink credits`,
    custom_str1:      user.id,
    custom_str2:      body.package_id,
    // custom_str3 stays reserved for payment_category (see payfast-webhook.js)
    custom_str4:      'skootlink', // app tag — Crosssa shares this merchant account
  };

  const signature = generateSignature(fields, PASSPHRASE);

  console.log(`[payfast-initiate] user=${user.id} package=${body.package_id} m_payment_id=${m_payment_id}`);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      action_url: PAYFAST_PROCESS_URL,
      fields: { ...fields, signature },
    }),
  };
};
