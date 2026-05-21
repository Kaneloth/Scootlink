// Initiates a real bank withdrawal via Paystack Transfers.
// Flow: validate → withdraw_request() RPC (deducts balance) → Paystack Transfer.
// If the Paystack call fails the balance is NOT refunded here — Paystack will
// fire transfer.failed webhook which calls withdraw_fail() to refund it.
const PAYSTACK_SECRET_KEY  = process.env.PAYSTACK_SECRET_KEY ?? '';
const SUPABASE_URL         = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

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

async function paystackPost(path, body) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message || `Paystack error on ${path}`);
  return json.data;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    if (!PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not set.');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Supabase env vars are not set.');

    const { user_id, account_name, account_number, bank_code, amount_zar } =
      JSON.parse(event.body || '{}');

    if (!user_id)         throw new Error('user_id is required');
    if (!account_number)  throw new Error('account_number is required');
    if (!bank_code)       throw new Error('bank_code is required');
    if (!account_name)    throw new Error('account_name is required');
    if (!amount_zar || amount_zar < 10) throw new Error('Minimum withdrawal is R 10');

    const amountCents = Math.round(amount_zar * 100);

    // 1. Deduct wallet balance atomically — returns the new transaction UUID
    const txId = await rpc('withdraw_request', {
      p_user_id:   user_id,
      p_amount:    amountCents,
      p_reference: null,
    });

    // 2. Create a Paystack Transfer Recipient
    const recipient = await paystackPost('/transferrecipient', {
      type:           'nuban',
      name:           account_name,
      account_number: account_number,
      bank_code:      bank_code,
      currency:       'ZAR',
      metadata:       { user_id },
    });

    // 3. Initiate the transfer — store the tx UUID as `reason` so the webhook
    //    can call withdraw_complete / withdraw_fail with it.
    await paystackPost('/transfer', {
      source:           'balance',
      amount:           amountCents,
      recipient:        recipient.recipient_code,
      reason:           txId, // UUID string — picked up by webhook
      currency:         'ZAR',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, transaction_id: txId }),
    };
  } catch (err) {
    console.error('paystack-withdraw error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
