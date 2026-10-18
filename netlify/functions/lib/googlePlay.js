/**
 * Google Play Developer API (Android Publisher v3) for in-app purchases
 * (migration 022). Plain fetch + Node crypto, like send-push-notification —
 * no google-auth-library (it breaks Netlify's esbuild bundling).
 *
 * Credentials: GOOGLE_PLAY_SERVICE_ACCOUNT_KEY (service account JSON), or the
 * existing FIREBASE_SERVICE_ACCOUNT_KEY when that account has been given
 * access in Play Console (Users and permissions → invite its client_email,
 * with "View financial data" and "Manage orders and subscriptions"), and the
 * Google Play Android Developer API is enabled in its Google Cloud project.
 *
 * GOOGLE_PLAY_PACKAGE_NAME   default co.za.skootlink.app
 * PLAY_LISTING_PRODUCT_ID    default listing_period (one-time, consumable)
 */
import crypto from 'crypto';

export const PLAY_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'co.za.skootlink.app';
export const PLAY_LISTING_PRODUCT_ID = process.env.PLAY_LISTING_PRODUCT_ID || 'listing_period';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cached = null; // { token, exp }

function serviceAccount() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Google Play is not configured (no service account key)');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Google Play service account key is not valid JSON: ${e.message}`);
  }
}

export function isPlayConfigured() {
  return !!(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = serviceAccount();
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const signature = b64url(crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  cached = { token: data.access_token, exp: now + Number(data.expires_in || 3600) };
  return cached.token;
}

async function call(method, path, query = null) {
  const url = `${API}/${encodeURIComponent(PLAY_PACKAGE_NAME)}/${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(method === 'POST' ? { 'Content-Length': '0' } : {}) },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(`Google Play API ${res.status}: ${data.error?.message || data.raw || 'error'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * A one-time product purchase. Fields used: purchaseState (0 purchased,
 * 1 cancelled, 2 pending), consumptionState (0 not yet, 1 consumed),
 * orderId, obfuscatedExternalAccountId, purchaseType (0 = test purchase by a
 * licence tester; absent for real ones).
 */
export function getProductPurchase(productId, token) {
  return call('GET', `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`);
}

/** Consume (and so acknowledge) — lets the owner buy the product again. */
export function consumeProductPurchase(productId, token) {
  return call('POST', `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`);
}

/** Refunded / charged-back / cancelled purchases since startTimeMillis (max 30 days back). */
export async function listVoidedPurchases(startTimeMillis) {
  const out = [];
  let pageToken = null;
  for (let page = 0; page < 20; page += 1) {
    const q = { startTime: String(startTimeMillis), maxResults: '1000' };
    if (pageToken) q.token = pageToken;
    const data = await call('GET', 'purchases/voidedpurchases', q);
    out.push(...(data.voidedPurchases || []));
    pageToken = data.tokenPagination?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
