// netlify/functions/admin-ban-user.js
//
// Called by Settings.jsx when an admin blacklists or un-blacklists a user.
// Uses the Supabase service-role key (server-side only) to:
//   1. Set / clear banned_until on auth.users  (blocks new sign-ins)
//   2. Revoke all active sessions via an RPC   (kicks the user out immediately)
//
// Environment variables required in Netlify:
//   SUPABASE_URL            — your project URL (same as VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY — service-role secret (never expose to the client)
//   SUPABASE_ANON_KEY       — public anon key (used only to verify the caller JWT)

const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Extract and verify the caller's JWT ──────────────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing access token' }) };
  }

  const supabaseUrl     = process.env.SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey         = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured — missing env vars' }) };
  }

  // Verify the caller is the admin by validating their JWT with the anon client
  const userClient = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !user || !ADMIN_EMAILS.includes(user.email)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden — admin only' }) };
  }

  // ── Parse request body ───────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { userId, ban } = body;
  if (!userId || typeof ban !== 'boolean') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or ban flag' }) };
  }

  // ── Service-role admin client ────────────────────────────────────────────
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Set or clear the auth-level ban ───────────────────────────────────
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: ban ? '876000h' : 'none',
  });
  if (banError) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update ban: ' + banError.message }) };
  }

  // ── 2. Revoke all active sessions immediately (ban only) ─────────────────
  //    Calls the admin_revoke_user_sessions() SQL function (SECURITY DEFINER)
  //    which deletes rows from auth.sessions and auth.refresh_tokens.
  if (ban) {
    const { error: rpcError } = await admin.rpc('admin_revoke_user_sessions', { p_user_id: userId });
    if (rpcError) {
      // Non-fatal — the auth ban already prevents any new sign-in;
      // existing access tokens will expire within the hour.
      console.warn('[admin-ban-user] Session revocation RPC failed:', rpcError.message);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
