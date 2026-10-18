/**
 * Netlify Function: payfast-webhook (ITN handler)
 * Verifies PayFast payment, then by custom_str3 (payment category):
 *   'gig_fare'     -> mark_gig_fare_paid() (migration 018) and, if the gig was
 *                     waiting for it, offer the gig to nearby drivers
 *   'verification' -> mark_verification_paid()
 *   (none)         -> credit package purchase
 * Set Notify URL in PayFast to: https://skootlink.co.za/.netlify/functions/payfast-webhook
 *
 * NOTE ON custom_str4 (app tag): Skootlink and Crosssa share one PayFast
 * merchant account, routed through one shared Hookdeck source that fans out
 * to both apps' webhooks. Hookdeck's Filter rule on the "payfast →
 * Skootlink" connection should already stop Crosssa's ITNs from reaching
 * here — this check is a second, independent line of defense in case that
 * filter is ever disabled, misconfigured, or bypassed (e.g. manual replay
 * in Hookdeck). custom_str4 is blank on older, already-in-flight payments
 * initiated before this tag existed, so we only reject when it's present
 * AND set to a different app — never when it's simply missing.
 */
import { createClient } from '@supabase/supabase-js';
import { generateITNSignature, PAYFAST_VALIDATE_URL } from './lib/payfast.js';
import { PACKAGES } from './lib/packages.js';
import { offerGigToDrivers, DEFAULT_RADIUS_METERS } from './lib/gigMatching.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PASSPHRASE = process.env.PAYFAST_PASSPHRASE || '';
const APP_TAG = 'skootlink';

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
    custom_str4: fields.custom_str4,
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

  // ── 3. Ignore ITNs tagged for a different app (belt-and-braces alongside
  //      the Hookdeck filter — see note at top of file) ──────────────────────
  if (fields.custom_str4 && fields.custom_str4 !== APP_TAG) {
    console.log(`[payfast-webhook] ignoring ITN tagged for other app: custom_str4=${fields.custom_str4} pf_payment_id=${fields.pf_payment_id}`);
    return { statusCode: 200, body: 'OK' };
  }

  // ── 4. Only process COMPLETE payments ──────────────────────────────────
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

  // ── Gig fares (card gigs are paid before the driver search starts) ────────
  if (payment_category === 'gig_fare') {
    const paid = parseFloat(fields.amount_gross || fields.amount || '0');
    const { data: rows, error } = await supabase.rpc('mark_gig_fare_paid', {
      p_m_payment_id: fields.m_payment_id,
      p_pf_payment_id: fields.pf_payment_id,
      p_amount: paid,
    });
    if (error) {
      console.error('[payfast-webhook] mark_gig_fare_paid failed:', error);
      return { statusCode: 500, body: 'Error' }; // PayFast retries the ITN
    }
    const { gig_id: gigId, action } = (rows && rows[0]) || {};
    console.log(`[payfast-webhook] gig fare m_payment_id=${fields.m_payment_id} gig=${gigId} action=${action} amount=${paid}`);

    if (action === 'start_matching') {
      const { data: gig, error: gErr } = await supabase
        .from('gig_requests')
        .select('id, gig_type, pickup_address, dropoff_address, fare_amount')
        .eq('id', gigId)
        .single();
      if (gErr) {
        console.error('[payfast-webhook] could not load paid gig:', gErr);
      } else {
        const { notified, pushed } = await offerGigToDrivers(supabase, gig, DEFAULT_RADIUS_METERS, 'payfast-webhook');
        console.log(`[payfast-webhook] gig=${gigId} paid; offered to ${notified} driver(s), ${pushed} push(es)`);
      }
    } else if (action === 'refund_queued') {
      await supabase.rpc('create_notification', {
        p_user_id: user_id,
        p_type: 'gig_refund',
        p_title: 'Payment received after your request ended',
        p_body: `We received R${paid.toFixed(2)} for a request that had already ended. It will be refunded to you.`,
        p_data: { gig_id: gigId },
      }).then(({ error: nErr }) => { if (nErr) console.error('[payfast-webhook] notify failed:', nErr); });
    } else if (action === 'amount_mismatch') {
      console.error(`[payfast-webhook] AMOUNT MISMATCH for gig fare m_payment_id=${fields.m_payment_id}: paid ${paid}`);
    }
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

  // ── 5. Amount sanity check ──────────────────────────────────────────────
  const paidAmount = parseFloat(fields.amount_gross || fields.amount || '0');
  if (Math.abs(paidAmount - pkg.price_zar) > 0.5) {
    console.error(`[payfast-webhook] amount mismatch: expected ${pkg.price_zar}, got ${paidAmount}`);
    return { statusCode: 200, body: 'OK' };
  }

  // ── 6. Idempotency check ────────────────────────────────────────────────
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

  // ── 7. Grant credits ────────────────────────────────────────────────────
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
