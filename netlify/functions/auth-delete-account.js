/**
 * auth-delete-account.js
 *
 * Permanently deletes the calling user's account and all associated data.
 * Requires SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.
 *
 * Deletion order (children before parent to satisfy FK constraints):
 *  1. Verify caller identity via access token.
 *  2. Delete all rows in every table that reference this user.
 *  3. Delete the auth.users row via the admin API (cascades to profiles).
 *  4. Return 200 so the client can clear cookies/localStorage and redirect.
 */

// Required so the native app (running from a different origin than
// skootlink.co.za) is allowed to call this function at all. The client uses
// credentials:'include' (to send cookies), and browsers/WebViews flatly
// refuse to allow credentialed requests with a wildcard '*' origin — the
// response has to echo back the SPECIFIC requesting origin instead, plus
// explicitly allow credentials. Without this exact combination, the
// preflight can look fine (e.g. via curl, which doesn't enforce this rule)
// while the real app still gets a silent "Failed to fetch".
function corsHeaders(event) {
  const origin = event.headers.origin || event.headers.Origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

exports.handler = async (event) => {
  const CORS_HEADERS = corsHeaders(event);

  // Browsers/WebViews send this automatically before the real POST when the
  // request is cross-origin — must succeed or the actual POST never gets sent.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server misconfigured — missing env vars' }),
    };
  }

  // ── Step 1: verify the caller's identity ──────────────────────────────────

  const authHeader = event.headers['authorization'] || '';
  const accessToken = authHeader.replace('Bearer ', '').trim();

  if (!accessToken) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No access token provided' }) };
  }

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: serviceRoleKey,
    },
  });

  if (!verifyRes.ok) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  const userData = await verifyRes.json();
  const userId = userData.id;

  if (!userId) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Could not determine user ID' }) };
  }

  // ── Step 2: delete all user data (child rows first) ───────────────────────
  // The service role key bypasses RLS, so these deletes always succeed even
  // if the table is empty or the column name slightly differs — we ignore
  // individual errors and press on so a missing table never blocks deletion.

  const restHeaders = {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  // Helper: DELETE rows matching a filter; silently ignores errors.
  const purge = (table, filter) =>
    fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: restHeaders,
    }).catch(() => {});

  // Run all child-table deletes in parallel for speed.
  await Promise.all([
    // transactions — may reference user as sender OR receiver
    purge('transactions', `from_user_id=eq.${userId}`),
    purge('transactions', `to_user_id=eq.${userId}`),
    purge('transactions', `user_id=eq.${userId}`),

    // rentals — user may appear as driver or owner/renter
    purge('rentals', `driver_id=eq.${userId}`),
    purge('rentals', `owner_id=eq.${userId}`),
    purge('rentals', `renter_id=eq.${userId}`),
    purge('rentals', `user_id=eq.${userId}`),

    // reviews — reviewer or the person being reviewed
    purge('reviews', `reviewer_id=eq.${userId}`),
    purge('reviews', `reviewed_id=eq.${userId}`),
    purge('reviews', `user_id=eq.${userId}`),

    // messages / chats
    purge('messages', `sender_id=eq.${userId}`),
    purge('messages', `receiver_id=eq.${userId}`),
    purge('messages', `from_id=eq.${userId}`),
    purge('messages', `to_id=eq.${userId}`),
    purge('chats', `user_id=eq.${userId}`),
    purge('chat_participants', `user_id=eq.${userId}`),

    // vehicles listed by this user
    purge('vehicles', `owner_id=eq.${userId}`),
    purge('vehicles', `user_id=eq.${userId}`),

    // sensitive info (not cascaded by FK)
    purge('user_sensitive_info', `user_id=eq.${userId}`),
  ]);

  // ── Step 3: delete the auth user (cascades to profiles via FK) ────────────

  const deleteRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  });

  if (!deleteRes.ok) {
    const body = await deleteRes.text();
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to delete account', detail: body }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true }),
  };
};