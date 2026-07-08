/**
 * Netlify Function: payfast-initiate
 * Builds a signed PayFast payment form for a credit package purchase.
 * POST body: { package_id: 'starter' | 'standard' | 'pro' | 'business' }
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
// skootlink.co.za) is allowed to call this function at all. Without these,
// the browser/WebView blocks the request before it even reaches here,
// surfacing to the user as a generic "Failed to fetch".
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler = async (event) => {
  // Browsers send this automatically before the real POST when the request
  // is cross-origin — must succeed or the actual POST never gets sent.
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

  // Native app: return via the custom URL scheme, which the OS hands back
  // to the app's own appUrlOpen listener — a real https:// return_url would
  // instead load skootlink.co.za as a totally separate, session-less origin
  // inside whatever browser context PayFast redirects through (the same
  // class of bug the Google sign-in flow had before its native rewrite).
  const isNative = body.is_native === true;
  const return_url = isNative
    ? `co.za.skootlink.app://payment-result?status=success&category=credits&package=${body.package_id}`
    : `${SITE_URL}/credits?payment=success`;
  const cancel_url = isNative
    ? `co.za.skootlink.app://payment-result?status=cancelled&category=credits`
    : `${SITE_URL}/credits?payment=cancelled`;

  console.log(`[payfast-initiate] is_native=${isNative} return_url=${return_url} cancel_url=${cancel_url}`);

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
