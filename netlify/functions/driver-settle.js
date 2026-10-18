/**
 * Netlify Function: driver-settle
 * A driver pays what they owe Skootlink (commission from cash gigs, migration
 * 020) through PayFast. The amount is always the full current debt, worked
 * out here, never taken from the app.
 *
 * ITN (payfast-webhook): custom_str3 = 'driver_settlement' ->
 * mark_driver_settlement_paid() adds a 'settlement' entry to the driver's
 * earnings, which brings the balance back to zero.
 *
 * POST body: { is_native?: boolean }
 * Auth: Bearer token — the driver.
 */
import { createClient } from '@supabase/supabase-js';
import { generateSignature, PAYFAST_PROCESS_URL, appBaseUrl, payfastNotifyUrl } from './lib/payfast.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

const PAYFAST_MIN = 5; // PayFast's smallest card payment, in rand

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  if (!merchantId || !merchantKey) return reply(500, { error: 'Payments are not configured' });

  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '').trim();
  if (!jwt) return reply(401, { error: 'Missing Authorization header' });
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) return reply(401, { error: 'Invalid or expired session' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON' }); }

  try {
    // Same balance rule as _driver_cash_balance (migration 020)
    const { data: rows, error } = await supabase
      .from('gig_earnings_ledger')
      .select('amount')
      .eq('driver_id', user.id)
      .eq('status', 'available')
      .is('withdrawal_id', null);
    if (error) throw error;
    const balance = Math.round((rows || []).reduce((t, r) => t + Number(r.amount), 0) * 100) / 100;
    const owed = Math.round(-balance * 100) / 100;
    if (owed <= 0) return reply(409, { error: "You don't owe anything right now." });
    if (owed < PAYFAST_MIN) {
      return reply(409, { error: `You owe R${owed.toFixed(2)}. PayFast's minimum is R${PAYFAST_MIN}; it will be taken from your next card earnings instead.` });
    }

    const m_payment_id = `settle_${user.id.slice(0, 8)}_${Date.now()}`;
    const { error: payErr } = await supabase.from('platform_payments').insert({
      user_id: user.id, kind: 'driver_settlement', amount: owed, m_payment_id,
    });
    if (payErr) throw payErr;

    const headers = event.headers || {};
    const base = appBaseUrl(headers);
    const isNative = body.is_native === true;
    const nativeBack = (status) => `${base}/.netlify/functions/payment-redirect?status=${status}&category=settlement`;
    const fields = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: isNative ? nativeBack('success') : `${base}/earnings?payment=success`,
      cancel_url: isNative ? nativeBack('cancelled') : `${base}/earnings?payment=cancelled`,
      notify_url: payfastNotifyUrl(headers),
      name_first: (user.user_metadata?.full_name || 'Skootlink').split(' ')[0],
      email_address: user.email,
      m_payment_id,
      amount: owed.toFixed(2),
      item_name: 'Skootlink commission (cash gigs)',
      item_description: 'Commission owed on cash gigs',
      custom_str1: user.id,
      custom_str2: 'settlement',
      custom_str3: 'driver_settlement',
      custom_str4: 'skootlink',
    };
    const signature = generateSignature(fields, process.env.PAYFAST_PASSPHRASE || '');
    console.log(`[driver-settle] driver=${user.id} owes R${owed.toFixed(2)} m_payment_id=${m_payment_id}`);
    return reply(200, { payment: { action_url: PAYFAST_PROCESS_URL, fields: { ...fields, signature } }, amount: owed });
  } catch (err) {
    console.error('[driver-settle] failed:', err);
    return reply(500, { error: 'Payment could not be started. Please try again.' });
  }
};
