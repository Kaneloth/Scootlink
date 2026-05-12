// Reads the httpOnly cookie, exchanges the stored refresh_token with Supabase,
// rotates the cookie with the brand-new token, and returns the access_token
// to the client so it can call supabase.auth.setSession().
// POST /.netlify/functions/auth-refresh
// No request body needed — token is read from the cookie.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse the httpOnly cookie
  const cookieHeader = event.headers.cookie || '';
  const match = cookieHeader.match(/scootlink_rt=([^;]+)/);
  if (!match) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'no-token' }),
    };
  }
  const refresh_token = decodeURIComponent(match[1]);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'server-misconfigured' }) };
  }

  // Exchange the refresh token with Supabase
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token }),
  });

  if (!res.ok) {
    // Token is invalid or revoked — clear the cookie
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'scootlink_rt=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
      },
      body: JSON.stringify({ error: 'session-expired' }),
    };
  }

  const data = await res.json();
  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  // Rotate — store the newest refresh token in the cookie
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': [
        `scootlink_rt=${data.refresh_token}`,
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Path=/',
        `Max-Age=${THIRTY_DAYS}`,
      ].join('; '),
    },
    body: JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    }),
  };
};
