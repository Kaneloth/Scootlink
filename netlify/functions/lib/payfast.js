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
