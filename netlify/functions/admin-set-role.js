// netlify/functions/admin-set-role.js
// Sets or removes is_admin in a user's Supabase Auth user_metadata.
// Requires the calling user to be an admin themselves.

import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const authHeader = event.headers.authorization || '';
  const callerToken = authHeader.replace('Bearer ', '');
  if (!callerToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify caller is an admin
  const anonClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
  const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser(callerToken);
  if (callerErr || !caller) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('is_admin')
    .eq('id', caller.id)
    .single();

  const ADMIN_EMAILS = ['kanelothelejane@gmail.com', 'kaneloth@skootlink.co.za'];
  const callerIsAdmin = callerProfile?.is_admin === true ||
    caller.user_metadata?.is_admin === true ||
    ADMIN_EMAILS.includes(caller.email);

  if (!callerIsAdmin) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden — admins only' }) };
  }

  const { userId, is_admin } = JSON.parse(event.body || '{}');
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'userId required' }) };
  }

  // Update the target user's auth metadata
  const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: { is_admin: !!is_admin },
  });

  if (updateErr) {
    return { statusCode: 500, body: JSON.stringify({ error: updateErr.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, userId, is_admin: !!is_admin }),
  };
};
