/**
 * Netlify Function: admin-signup-grants
 * Admin-only read/write access to denied signup credit grants.
 *
 * signup_grant_attempts has RLS enabled with zero policies — meaning it's
 * completely inaccessible to any direct client-side query, admin or not,
 * with no error thrown (RLS just silently returns zero rows). This
 * function reads it server-side with the service role instead of ever
 * loosening that table's RLS, since it holds other users' emails, IPs,
 * and phone-based fraud signals — not something any authenticated client
 * should be able to query directly, even by accident.
 *
 * POST body:
 *   { action: 'list' }
 *   { action: 'grant', userId: string, amount: number }
 * Auth: Bearer token, verified to belong to an admin (user_metadata.is_admin === true)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing authorization token' }) };
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || user.user_metadata?.is_admin !== true) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  try {
    if (body.action === 'list') {
      const { data: denied, error } = await supabaseAdmin
        .from('signup_grant_attempts')
        .select('*')
        .eq('granted', 0)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;

      // Keep only the most recent attempt per user — someone can trigger
      // several denied attempts (e.g. retrying signup), we only need one row.
      const latestByUser = new Map();
      for (const a of denied || []) {
        if (!a.user_id) continue;
        if (!latestByUser.has(a.user_id)) latestByUser.set(a.user_id, a);
      }
      const rows = [...latestByUser.values()];
      const userIds = rows.map(r => r.user_id);

      const [{ data: profiles }, { data: existingGrants }] = await Promise.all([
        userIds.length
          ? supabaseAdmin.from('profiles').select('id, full_name, email, phone, account_type, customer_code').in('id', userIds)
          : Promise.resolve({ data: [] }),
        userIds.length
          ? supabaseAdmin.from('credit_ledger').select('user_id').eq('type', 'signup_bonus').in('user_id', userIds)
          : Promise.resolve({ data: [] }),
      ]);

      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
      const alreadyGranted = new Set((existingGrants || []).map(g => g.user_id));

      const merged = rows.map(r => ({
        ...r,
        profile: profileMap[r.user_id] || null,
        alreadyResolved: alreadyGranted.has(r.user_id),
      }));

      return { statusCode: 200, body: JSON.stringify({ attempts: merged }) };
    }

    if (body.action === 'grant') {
      const { userId, amount } = body;
      if (!userId || !Number.isFinite(amount) || amount <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'userId and a positive amount are required' }) };
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, phone')
        .eq('id', userId)
        .maybeSingle();
      if (!profile) {
        return { statusCode: 400, body: JSON.stringify({ error: 'No matching profile — cannot grant.' }) };
      }

      // Re-check right before granting — someone else on the team, or the
      // person themself via a later real signup retry, may have already
      // resolved this since the page loaded.
      const { data: dupe } = await supabaseAdmin
        .from('credit_ledger')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'signup_bonus')
        .maybeSingle();
      if (dupe) {
        return { statusCode: 200, body: JSON.stringify({ alreadyResolved: true, profile }) };
      }

      // Written with type: 'signup_bonus' — identical to what
      // grant-signup-credits.js writes on a clean automatic grant, so this
      // is indistinguishable from a real signup bonus in the ledger.
      const { error: creditErr } = await supabaseAdmin.rpc('add_credits', {
        p_user_id:     userId,
        p_amount:      amount,
        p_type:        'signup_bonus',
        p_description: `Welcome bonus — ${amount} free credits`,
        p_ref_id:      null,
      });
      if (creditErr) throw creditErr;

      // Backfill the same fraud-guard records a clean automatic grant would
      // have written, so future signup attempts on this email/phone are
      // still correctly blocked — otherwise this override would quietly
      // weaken the guards for next time.
      if (profile.email) {
        await supabaseAdmin.from('email_grants').upsert(
          { email: profile.email.toLowerCase().trim(), user_id: userId, granted_at: new Date().toISOString() },
          { onConflict: 'email' }
        );
      }
      if (profile.phone) {
        const cleanPhone = profile.phone.replace(/\s+/g, '').replace(/[^+\d]/g, '');
        if (cleanPhone) {
          await supabaseAdmin.from('phone_fingerprints').upsert(
            { phone: cleanPhone, user_id: userId, credit_granted: true },
            { onConflict: 'phone' }
          );
        }
      }

      return { statusCode: 200, body: JSON.stringify({ granted: amount, profile }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('[admin-signup-grants] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
