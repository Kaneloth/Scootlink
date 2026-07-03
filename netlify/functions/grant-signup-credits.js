/**
 * Netlify Function: grant-signup-credits
 * Awards free sign-up credits to new users after onboarding.
 *
 * Credits awarded:
 *   Driver              → 250 credits
 *   Owner or Both       → 500 credits
 *
 * Fraud guards (layered):
 *   0. email_grants table   — blocks re-registration with same email
 *   1. credit_ledger check  — blocks duplicate grants for active user_id
 *   2. phone_fingerprints   — one grant per unique phone number
 *   3. IP rate limit        — max 2 grants per IP per 30 days
 *
 * POST body: { user_id, email, phone, profile_type }
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const IP_MAX_GRANTS = 1;

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { user_id, email, phone, profile_type } = body;
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || event.headers['client-ip']
           || 'unknown';

  if (!user_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'user_id required' }) };
  }

  // Driver → 250 credits, Owner or Both → 500 credits
  const freeCredits = (profile_type === 'owner' || profile_type === 'both') ? 500 : 250;

  // ── Verify user_id actually exists in profiles ────────────────────────────
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user_id)
    .maybeSingle();
  if (profileErr || !profile) {
    console.warn(`[grant-signup-credits] Unknown user_id=${user_id}`);
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid user' }) };
  }

  // ── Guard 0: Email fingerprint ────────────────────────────────────────────
  if (email && email.trim() !== '') {
    const cleanEmail = email.toLowerCase().trim();
    const { data: emailFp } = await supabase
      .from('email_grants')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();
    if (emailFp) {
      console.warn(`[grant-signup-credits] Denied ${cleanEmail} — email already received bonus`);
      return { statusCode: 200, body: JSON.stringify({ granted: 0, reason: 'email_known' }) };
    }
  }

  // ── Guard 1: Duplicate grant for active user_id ───────────────────────────
  const { data: existing } = await supabase
    .from('credit_ledger')
    .select('id')
    .eq('user_id', user_id)
    .eq('type', 'signup_bonus')
    .maybeSingle();
  if (existing) {
    return { statusCode: 200, body: JSON.stringify({ granted: 0, reason: 'already_granted' }) };
  }

  // ── Guard 2: Phone fingerprint ────────────────────────────────────────────
  if (phone && phone.trim() !== '') {
    const cleanPhone = phone.replace(/\s+/g, '').replace(/[^+\d]/g, '');
    const { data: phoneFp } = await supabase
      .from('phone_fingerprints')
      .select('credit_granted')
      .eq('phone', cleanPhone)
      .maybeSingle();
    if (phoneFp?.credit_granted) {
      console.warn(`[grant-signup-credits] Denied user=${user_id} — phone already used`);
      return { statusCode: 200, body: JSON.stringify({ granted: 0, reason: 'phone_known' }) };
    }
    await supabase
      .from('phone_fingerprints')
      .upsert({ phone: cleanPhone, user_id, credit_granted: true }, { onConflict: 'phone' });
  }

  // ── Guard 3: IP rate limit ────────────────────────────────────────────────
  if (ip !== 'unknown') {
    const { count } = await supabase
      .from('ip_signups')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip);
    await supabase.from('ip_signups').insert({ ip, user_id });
    if ((count ?? 0) >= IP_MAX_GRANTS) {
      console.warn(`[grant-signup-credits] Denied user=${user_id} — IP limit reached (ip=${ip})`);
      return { statusCode: 200, body: JSON.stringify({ granted: 0, reason: 'ip_limit' }) };
    }
  }

  // ── Record email grant BEFORE crediting ───────────────────────────────────
  if (email && email.trim() !== '') {
    await supabase
      .from('email_grants')
      .upsert(
        { email: email.toLowerCase().trim(), user_id, granted_at: new Date().toISOString() },
        { onConflict: 'email' }
      );
  }

  // ── Grant free credits ────────────────────────────────────────────────────
  const { error: creditErr } = await supabase.rpc('add_credits', {
    p_user_id:     user_id,
    p_amount:      freeCredits,
    p_type:        'signup_bonus',
    p_description: `Welcome bonus — ${freeCredits} free credits`,
    p_ref_id:      null,
  });
  if (creditErr) {
    console.error('[grant-signup-credits] add_credits failed:', creditErr);
    return { statusCode: 500, body: JSON.stringify({ error: creditErr.message }) };
  }

  console.log(`[grant-signup-credits] Granted ${freeCredits} credits to user=${user_id} type=${profile_type} ip=${ip}`);
  return {
    statusCode: 200,
    body: JSON.stringify({ granted: freeCredits, reason: 'clean_identity' }),
  };
};
