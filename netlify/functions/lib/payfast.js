/**
 * payfast — shared PayFast helpers
 * Place at: netlify/functions/lib/payfast.js
 */
import crypto from 'crypto';

export const PAYFAST_MODE         = (process.env.PAYFAST_MODE || 'sandbox').toLowerCase();
export const PAYFAST_HOST         = PAYFAST_MODE === 'live' ? 'www.payfast.co.za' : 'sandbox.payfast.co.za';
export const PAYFAST_PROCESS_URL  = `https://${PAYFAST_HOST}/eng/process`;
export const PAYFAST_VALIDATE_URL = `https://${PAYFAST_HOST}/eng/query/validate`;
export const SITE_URL             = process.env.SITE_URL || 'https://skootlink.co.za';

export function pfEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function buildSignatureString(fields, passphrase) {
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'signature') continue;
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${pfEncode(value)}`);
  }
  let str = parts.join('&');
  if (passphrase) str += `&passphrase=${pfEncode(passphrase)}`;
  return str;
}

export function generateSignature(fields, passphrase) {
  return crypto.createHash('md5').update(buildSignatureString(fields, passphrase)).digest('hex');
}

export function buildITNSignatureString(fields, passphrase) {
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'signature') continue;
    parts.push(`${key}=${pfEncode(value ?? '')}`);
  }
  let str = parts.join('&');
  if (passphrase) str += `&passphrase=${pfEncode(passphrase)}`;
  return str;
}

export function generateITNSignature(fields, passphrase) {
  return crypto.createHash('md5').update(buildITNSignatureString(fields, passphrase)).digest('hex');
}

// ── Where PayFast should send people (and ITNs) back to ──────────────────────
// The deploy that served the request: on a Deploy Preview that is the
// preview's own address, so a test payment returns to the preview and its ITN
// reaches the preview's webhook (the code being tested). Netlify does not
// expose CONTEXT / DEPLOY_PRIME_URL to functions at runtime (only URL,
// SITE_NAME and SITE_ID), so the request's host is used — but only if it is
// this site: SITE_URL's host, <SITE_NAME>.netlify.app or a
// <prefix>--<SITE_NAME>.netlify.app preview/branch address. Anything else
// falls back to SITE_URL.
export function appBaseUrl(headers = {}) {
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim().toLowerCase();
  const siteName = (process.env.SITE_NAME || '').toLowerCase();
  let siteHost = '';
  try { siteHost = new URL(SITE_URL).host.toLowerCase(); } catch { /* ignore */ }
  const ok = host && (
    host === siteHost
    || host === `www.${siteHost}`
    || (siteName && (host === `${siteName}.netlify.app` || host.endsWith(`--${siteName}.netlify.app`)))
  );
  return ok ? `https://${host}` : SITE_URL.replace(/\/$/, '');
}

// PAYFAST_NOTIFY_URL overrides this (e.g. to route through Hookdeck).
export function payfastNotifyUrl(headers = {}) {
  return process.env.PAYFAST_NOTIFY_URL || `${appBaseUrl(headers)}/.netlify/functions/payfast-webhook`;
}

// ── PayFast REST API (api.payfast.co.za) ──────────────────────────────────────
// Signature, as in PayFast's own PHP SDK (Auth::generateApiSignature): the
// headers merchant-id / version / timestamp, plus query and body fields, plus
// passphrase, sorted by key, PHP-urlencoded, joined with &, then MD5.
export const PAYFAST_API_URL = 'https://api.payfast.co.za';

function apiTimestamp(d = new Date()) {
  // PHP date("Y-m-d\TH:i:sO") in UTC, e.g. 2026-10-17T19:30:00+0000
  return d.toISOString().replace(/\.\d{3}Z$/, '+0000');
}

export function generateApiSignature(data, passphrase) {
  const all = { ...data };
  if (passphrase) all.passphrase = passphrase;
  return crypto.createHash('md5').update(
    Object.keys(all).sort()
      .filter((k) => k !== 'signature')
      .map((k) => `${k}=${pfEncode(all[k])}`)
      .join('&'),
  ).digest('hex');
}

export async function payfastApiRequest(method, path, { query = {}, json = null } = {}) {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  const headers = { 'merchant-id': merchantId, version: 'v1', timestamp: apiTimestamp() };
  const q = { ...query };
  if (PAYFAST_MODE !== 'live') q.testing = 'true';
  // As in the SDK: the signature covers headers, the caller's query fields and the body
  const signature = generateApiSignature({ ...headers, ...query, ...(json || {}) }, passphrase);
  const qs = new URLSearchParams(q).toString();
  const res = await fetch(`${PAYFAST_API_URL}/${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: { ...headers, signature, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}
