/**
 * Netlify Function: grant-signup-credits
 * Awards free sign-up credits to new users after onboarding.
 *
 * Credits awarded (base amounts are admin-configurable via app_settings,
 * see admin-app-settings.js's update_signup_credits action; the numbers
 * below are the fallback defaults used if that read ever fails):
 *   Driver                              → 350 credits
 *   Owner or Both, no vehicle listed    → 1250 credits
 *   Owner or Both, vehicle listed       → base owner amount − 250
 *     (the onboarding vehicle listing itself is free and worth 250 credits
 *     at the normal 1st-vehicle tier — this keeps the total value identical
 *     to the full owner amount either way, it's just structured differently
 *     depending on whether they actually used the free listing. The 250cr
 *     discount itself is fixed, independent of the admin-configurable base.)
 *
 * Fraud guards (layered):
 *   0. email_grants table   — blocks re-registration with same email
 *   1. credit_ledger check  — blocks duplicate grants for active user_id
 *   2. phone_fingerprints   — one grant per unique phone number
 *   3. IP rate limit        — max 2 grants per IP, ever
 *      (lifetime cap, not time-boxed: a rolling window doesn't stop someone
 *      from waiting it out and re-signing up once their credits run low.
 *      Kept slightly above 1 for SA mobile carrier-grade NAT, where
 *      unrelated real users can share one public IP.)
 *
 * POST body: { user_id, email, phone, profile_type, vehicle_listed }
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const IP_MAX_GRANTS = 2;

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Used only if the app_settings read below fails — keeps behavior identical
// to what shipped before admin control existed, rather than ever risking a
// $0 grant because of a transient DB hiccup.
const FALLBACK_DRIVER_CREDITS = 350;
const FALLBACK_OWNER_CREDITS  = 1250;

// Fixed, not admin-configurable — see admin-app-settings.js's
// update_signup_credits action for the two amounts that are.
const VEHICLE_LISTED_DISCOUNT = 250;

// Records every attempt (granted or denied, and why) to a permanent audit
// table — Netlify's own function logs rotate out too quickly to rely on.
async function logAttempt({ user_id, email, ip, profile_type, granted, reason }) {
  try {
    await supabase.from('signup_grant_attempts').insert({
      user_id: user_id || null,
      email:   email ? email.toLowerCase().trim() : null,
      ip,
      profile_type: profile_type || null,
      granted,
      reason,
    });
  } catch (err) {
    console.error('[grant-signup-credits] Failed to write audit log:', err);
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: 'Invalid JSON' }; }

  const { user_id, email, phone, profile_type, vehicle_listed } = body;
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || event.headers['client-ip']
           || 'unknown';

  if (!user_id) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'user_id required' }) };
  }

  // Driver → configurable base (default 350), Owner or Both → configurable
  // base (default 1250), minus the fixed 250cr discount if they used the
  // free onboarding vehicle listing.
  const isOwnerLike = profile_type === 'owner' || profile_type === 'both';

  let driverBase = FALLBACK_DRIVER_CREDITS;
  let ownerBase  = FALLBACK_OWNER_CREDITS;
  try {
    const { data: settings, error: settingsErr } = await supabase
      .from('app_settings')
      .select('signup_credits_driver, signup_credits_owner')
      .eq('id', 1)
      .single();
    if (settingsErr) throw settingsErr;
    if (Number.isInteger(settings?.signup_credits_driver)) driverBase = settings.signup_credits_driver;
    if (Number.isInteger(settings?.signup_credits_owner))  ownerBase  = settings.signup_credits_owner;
  } catch (err) {
    console.warn('[grant-signup-credits] Could not read app_settings, using fallback amounts:', err.message);
  }

  const freeCredits = isOwnerLike
    ? Math.max(0, vehicle_listed ? ownerBase - VEHICLE_LISTED_DISCOUNT : ownerBase)
    : driverBase;

  // ── Verify user_id actually exists in profiles ────────────────────────────
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user_id)
    .maybeSingle();
  if (profileErr || !profile) {
    console.warn(`[grant-signup-credits] Unknown user_id=${user_id}`);
    await logAttempt({ user_id, email, ip, profile_type, granted: 0, reason: 'invalid_user' });
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid user' }) };
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
      await logAttempt({ user_id, email, ip, profile_type, granted: 0, reason: 'email_known' });
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ granted: 0, reason: 'email_known' }) };
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
    await logAttempt({ user_id, email, ip, profile_type, granted: 0, reason: 'already_granted' });
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ granted: 0, reason: 'already_granted' }) };
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
      await logAttempt({ user_id, email, ip, profile_type, granted: 0, reason: 'phone_known' });
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ granted: 0, reason: 'phone_known' }) };
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
      await logAttempt({ user_id, email, ip, profile_type, granted: 0, reason: 'ip_limit' });
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ granted: 0, reason: 'ip_limit' }) };
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
    await logAttempt({ user_id, email, ip, profile_type, granted: 0, reason: 'error' });
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: creditErr.message }) };
  }

  console.log(`[grant-signup-credits] Granted ${freeCredits} credits to user=${user_id} type=${profile_type} vehicle_listed=${!!vehicle_listed} ip=${ip}`);
  await logAttempt({ user_id, email, ip, profile_type, granted: freeCredits, reason: 'clean_identity' });
  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ granted: freeCredits, reason: 'clean_identity' }),
  };
};