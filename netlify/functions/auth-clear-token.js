// Clears the httpOnly cookie on password-based logout.
// POST /.netlify/functions/auth-clear-token

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'scootlink_rt=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    },
    body: JSON.stringify({ ok: true }),
  };
};
