/**
 * Netlify Function: payfast-webhook (ITN handler)
 * Verifies PayFast payment and grants credits on success.
 * Set Notify URL in PayFast to: https://skootlink.co.za/.netlify/functions/payfast-webhook
 */
import { createClient } from '@supabase/supabase-js';
import { generateITNSignature, PAYFAST_VALIDATE_URL } from './lib/payfast.js';
import { PACKAGES } from './lib/packages.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PASSPHRASE = process.env.PAYFAST_PASSPHRASE || '';

// PayFast live server IPs
const PAYFAST_VALID_IPS = [
  '197.97.145.144', '197.97.145.145', '197.97.145.146', '197.97.145.147',
  '197.97.145.148', '197.97.145.149', '197.97.145.150', '197.97.145.151',
  '197.97.145.152', '197.97.145.153', '197.97.145.154', '197.97.145.155',
  '197.97.145.156', '197.97.145.157', '197.97.145.158', '197.97.145.159',
];

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const params = new URLSearchParams(event.body || '');
  const fields = {};
  for (const [k, v] of params.entries()) fields[k] = v;

  console.log('[payfast-webhook] ITN received:', {
    pf_payment_id: fields.pf_payment_id,
    payment_status: fields.payment_status,
    m_payment_id: fields.m_payment_id,
  });

  // ── 0. IP validation skipped — requests proxied via Hookdeck ───────────
  // Hookdeck's IP is not in PayFast's range. Signature + server validation
  // below provide sufficient security.

  // ── 1. Signature verification ───────────────────────────────────────────
  const receivedSig = fields.signature;
  const expectedSig = generateITNSignature(fields, PASSPHRASE);
  if (receivedSig !== expectedSig) {
    console.error('[payfast-webhook] SIGNATURE MISMATCH');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  // ── 2. Server-to-server validation ─────────────────────────────────────
  try {
    const validateRes = await fetch(PAYFAST_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: event.body,
    });
    const validateText = (await validateRes.text()).trim();
    if (validateText !== 'VALID') {
      console.error('[payfast-webhook] PayFast validate returned:', validateText);
      return { statusCode: 400, body: 'Invalid' };
    }
  } catch (err) {
    console.error('[payfast-webhook] validate request failed:', err);
    return { statusCode: 500, body: 'Validation error' };
  }

  // ── 3. Only process COMPLETE payments ──────────────────────────────────
  if (fields.payment_status !== 'COMPLETE') {
    console.log(`[payfast-webhook] payment_status=${fields.payment_status} — no action`);
    return { statusCode: 200, body: 'OK' };
  }

  const user_id    = fields.custom_str1;
  const package_id = fields.custom_str2;
  const payment_category = fields.custom_str3; // 'verification' or undefined (credit purchase)

  if (!user_id) {
    console.error('[payfast-webhook] missing custom_str1 (user_id)');
    return { statusCode: 200, body: 'OK' };
  }

  // ── Handle verification service payments ────────────────────────────────────
  if (payment_category === 'verification') {
    const { error } = await supabase.rpc('mark_verification_paid', {
      p_m_payment_id: fields.m_payment_id,
    });
    if (error) {
      console.error('[payfast-webhook] mark_verification_paid failed:', error);
    } else {
      console.log(`[payfast-webhook] Verification payment marked paid: user=${user_id} service=${package_id}`);
    }
    return { statusCode: 200, body: 'OK' };
  }

  // ── Handle credit package payments (existing flow) ──────────────────────────
  const pkg = PACKAGES[package_id];
  if (!pkg) {
    console.error('[payfast-webhook] unknown package:', package_id);
    return { statusCode: 200, body: 'OK' };
  }

  // ── 4. Amount sanity check ──────────────────────────────────────────────
  const paidAmount = parseFloat(fields.amount_gross || fields.amount || '0');
  if (Math.abs(paidAmount - pkg.price_zar) > 0.5) {
    console.error(`[payfast-webhook] amount mismatch: expected ${pkg.price_zar}, got ${paidAmount}`);
    return { statusCode: 200, body: 'OK' };
  }

  // ── 5. Idempotency check ────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('credit_ledger')
    .select('id')
    .eq('ref_id', fields.pf_payment_id)
    .eq('type', 'purchase')
    .maybeSingle();

  if (existing) {
    console.log(`[payfast-webhook] pf_payment_id=${fields.pf_payment_id} already processed`);
    return { statusCode: 200, body: 'OK' };
  }

  // ── 6. Grant credits ────────────────────────────────────────────────────
  const { error: creditErr } = await supabase.rpc('add_credits', {
    p_user_id:     user_id,
    p_amount:      pkg.credits,
    p_type:        'purchase',
    p_description: `${pkg.label} via PayFast — R${pkg.price_zar}`,
    p_ref_id:      fields.pf_payment_id,
  });

  if (creditErr) {
    console.error('[payfast-webhook] add_credits failed:', creditErr);
    return { statusCode: 500, body: 'Error' };
  }

  console.log(`[payfast-webhook] Granted ${pkg.credits} credits to user=${user_id}`);
  return { statusCode: 200, body: 'OK' };
};
