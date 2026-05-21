// Receives Paystack webhook events, verifies the HMAC signature, and updates
// the database via Supabase RPC functions (SECURITY DEFINER, bypasses RLS).
const crypto = require('crypto');

const PAYSTACK_SECRET_KEY  = process.env.PAYSTACK_SECRET_KEY ?? '';
const SUPABASE_URL         = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function rpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc ${fn} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// Keep profiles.wallet_balance in sync (ZAR, 2 dp) so the rest of the app
// (which reads auth.me() → profiles) shows the correct balance without changes.
async function syncProfileBalance(userId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${userId}&select=balance`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    const rows = await res.json();
    if (!rows?.length) return;
    const balanceZar = rows[0].balance / 100;
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ wallet_balance: balanceZar }),
    });
  } catch (e) {
    console.error('syncProfileBalance error:', e.message);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify Paystack HMAC-SHA512 signature
  const signature = event.headers['x-paystack-signature'];
  const expected  = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(event.body)
    .digest('hex');

  if (signature !== expected) {
    console.warn('Invalid Paystack webhook signature');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { event: eventName, data } = payload;
  console.log('Paystack webhook:', eventName, data?.reference);

  try {
    // ── Payment / top-up ─────────────────────────────────────────────────────
    if (eventName === 'charge.success') {
      const userId    = data?.metadata?.user_id;
      const amountCents = data?.amount; // already in cents
      const reference = data?.reference;

      if (!userId || !amountCents) {
        console.error('charge.success missing user_id or amount in metadata');
        return { statusCode: 200, body: 'ok' };
      }

      await rpc('add_funds', {
        p_user_id:   userId,
        p_amount:    amountCents,
        p_reference: reference,
      });
      await syncProfileBalance(userId);
      console.log(`add_funds: user=${userId} amount=${amountCents}c ref=${reference}`);
    }

    // ── Transfer success (withdrawal paid out) ────────────────────────────────
    if (eventName === 'transfer.success') {
      const txId = data?.reason; // we store the tx UUID as the transfer reason
      if (txId) {
        await rpc('withdraw_complete', { p_transaction_id: txId });
        console.log(`withdraw_complete: tx=${txId}`);
      }
    }

    // ── Transfer failed or reversed (refund the wallet) ───────────────────────
    if (eventName === 'transfer.failed' || eventName === 'transfer.reversed') {
      const txId = data?.reason;
      if (txId) {
        await rpc('withdraw_fail', { p_transaction_id: txId });
        // Refund restores balance in wallets table — sync to profiles
        const fromUserId = data?.recipient?.metadata?.user_id;
        if (fromUserId) await syncProfileBalance(fromUserId);
        console.log(`withdraw_fail: tx=${txId}`);
      }
    }
  } catch (err) {
    // Log the error but always return 200 to prevent Paystack retries for
    // errors we can't recover from (e.g. duplicate reference already processed)
    console.error('Webhook handler error:', err.message);
  }

  return { statusCode: 200, body: 'ok' };
};
