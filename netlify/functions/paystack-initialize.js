// Initializes a Paystack transaction server-side and returns the access_code
// so the frontend can open the Paystack inline popup securely.
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ?? '';

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

    const { amount_zar, email, user_id } = JSON.parse(event.body || '{}');
    if (!amount_zar || amount_zar <= 0) throw new Error('Invalid amount');
    if (!email) throw new Error('email is required');
    if (!user_id) throw new Error('user_id is required');

    // Paystack amounts are in the smallest currency unit — ZAR cents
    const amountCents = Math.round(amount_zar * 100);

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountCents,
        currency: 'ZAR',
        metadata: { user_id, amount_zar },
        channels: ['card', 'bank', 'eft'],
      }),
    });

    const json = await res.json();
    if (!json.status) throw new Error(json.message || 'Paystack initialization failed');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        access_code: json.data.access_code,
        reference: json.data.reference,
        authorization_url: json.data.authorization_url,
      }),
    };
  } catch (err) {
    console.error('paystack-initialize error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
