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

  // Always a real https:// URL — PayFast's own acceptance of non-standard
  // schemes for return_url/cancel_url is unverified, so route through a
  // static bridge page on our own domain instead. That page then triggers
  // the co.za.skootlink.app:// deep link itself (which we've already
  // proven works, via the Google sign-in flow), falling back to a normal
  // in-page redirect for web/desktop users where no app is installed to
  // catch the deep link. See public/payment-callback.html.
  // Native: a real server-side 302 redirect straight to the custom scheme
  // (payment-redirect function) — the same mechanism the Google sign-in
  // flow already uses successfully. The previous approach (a static bridge
  // page doing a client-side JS redirect) was silently blocked by Chrome's
  // policy against gesture-less navigation to custom schemes — confirmed
  // via on-device debug logging showing appUrlOpen never fired at all.
  // Web: unchanged, a normal in-app https destination.
  const isNative = body.is_native === true;
  const return_url = isNative
    ? `${SITE_URL}/.netlify/functions/payment-redirect?status=success&category=credits&package=${body.package_id}`
    : `${SITE_URL}/credits?payment=success`;
  const cancel_url = isNative
    ? `${SITE_URL}/.netlify/functions/payment-redirect?status=cancelled&category=credits`
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
    // custom_str3 stays reserved for payment_category (see payfast-webhook.js)
    custom_str4:      'skootlink', // app tag — Crosssa shares this merchant account/Hookdeck source; lets both the Hookdeck filter and the webhook guard ignore ITNs meant for the other app
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
