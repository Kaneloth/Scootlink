// Receives a Supabase refresh_token from the client and stores it in an
// httpOnly cookie so it is never readable by JavaScript.
// POST /.netlify/functions/auth-set-token
// Body: { refresh_token: string }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let refresh_token;
  try {
    ({ refresh_token } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid-body' }) };
  }

  if (!refresh_token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'missing-token' }) };
  }

  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        `scootlink_rt=${refresh_token}`,
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Path=/',
        `Max-Age=${THIRTY_DAYS}`,
      ].join('; '),
    },
    body: JSON.stringify({ ok: true }),
  };
};
