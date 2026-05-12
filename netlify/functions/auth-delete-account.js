/**
 * auth-delete-account.js
 *
 * Permanently deletes the calling user's account and all associated data.
 * Requires SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables —
 * this key must NEVER be in client-side code.
 *
 * Flow:
 *  1. Client sends its current access_token in the Authorization header.
 *  2. We verify the token with Supabase (getUser) to confirm who is deleting.
 *  3. We delete sensitive data from user_sensitive_info (the RLS-protected table).
 *  4. We delete the auth user via the admin API — this cascades to profiles via FK.
 *  5. Return 200 so the client can clear cookies/localStorage and redirect.
 *
 * Add to Netlify → Site configuration → Environment variables:
 *   SUPABASE_SERVICE_ROLE_KEY  — found in Supabase → Settings → API → service_role key
 *   VITE_SUPABASE_URL          — already added for auth-refresh
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server misconfigured — missing env vars' }),
    };
  }

  // ── Step 1: verify the caller's identity ──────────────────────────────────

  const authHeader = event.headers['authorization'] || '';
  const accessToken = authHeader.replace('Bearer ', '').trim();

  if (!accessToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No access token provided' }) };
  }

  // Verify the token and get the user's ID
  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: serviceRoleKey,
    },
  });

  if (!verifyRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  const userData = await verifyRes.json();
  const userId = userData.id;

  if (!userId) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Could not determine user ID' }) };
  }

  // ── Step 2: delete sensitive data first ───────────────────────────────────
  // This table is NOT auto-cascaded by the auth.users FK, so delete it manually.

  await fetch(`${supabaseUrl}/rest/v1/user_sensitive_info?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
  });

  // ── Step 3: delete the auth user (cascades to profiles table) ────────────
  // Uses the admin API — only possible with the service role key.

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
      body: JSON.stringify({ error: 'Failed to delete account', detail: body }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};
