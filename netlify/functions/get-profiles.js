/**
 * get-profiles.js
 *
 * Fetches one or more profiles by ID using the Supabase service role key,
 * which bypasses RLS so phone numbers and other restricted columns are always
 * returned — even for profiles that are not the calling user's own.
 *
 * POST body: { ids: string[] }
 * Returns:   Profile[] with id, full_name, email, phone, avatar_url,
 *            avatar_visible, verified, wallet_balance, rating
 */

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Server misconfigured — missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
    };
  }

  let ids;
  try {
    // Netlify may base64-encode the body for binary content types
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}');
    ({ ids } = JSON.parse(rawBody));
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: '`ids` must be a non-empty array' }) };
  }

  // PostgREST IN filter: id=in.(uuid1,uuid2,...)
  const inList = ids.join(',');
  const select = 'id,full_name,email,phone,avatar_url,avatar_visible,verified,wallet_balance,rating';
  const url    = `${supabaseUrl}/rest/v1/profiles?id=in.(${inList})&select=${select}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey:         serviceRoleKey,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[get-profiles] Supabase error:', text);
      return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: text }) };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('[get-profiles] Unexpected error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
