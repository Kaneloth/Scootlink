/**
 * get-profiles.js
 *
 * Returns profiles for a list of user ids, for the signed-in caller.
 * Uses the service role (bypasses RLS) but decides field by field what the
 * caller may see:
 *
 *   PUBLIC_FIELDS   — any signed-in user (names, badges, rating, etc.)
 *   PRIVATE_FIELDS  — email, phone, licence number: only for
 *                       - the caller's own profile,
 *                       - an admin,
 *                       - someone who shares a rental with the caller
 *                         (any status: proposal, contract, active, ended), or
 *                       - someone matched with the caller on a gig
 *                         (customer <-> assigned driver).
 *
 * wallet_balance is never returned (dead column).
 *
 * Before this version the function needed no sign-in and returned email,
 * phone and wallet_balance for ANY id it was given, and pasted the ids
 * straight into the query URL. Both are fixed here.
 *
 * POST body: { ids: string[] }   (user uuids, max 100)
 * Header:    Authorization: Bearer <caller's access token>
 *            (optional for now: without it, only PUBLIC_FIELDS are returned,
 *            so already-installed app versions keep working — see handler)
 * Returns:   Profile[]  (private fields omitted where not allowed)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const PUBLIC_FIELDS = [
  'id', 'full_name', 'location', 'verified', 'id_verified', 'licence_verified',
  'rating', 'gender', 'driving_experience', 'license_year',
];
const PRIVATE_FIELDS = ['email', 'phone', 'license_number'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 100;

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  // ── Who is asking? ─────────────────────────────────────────────────────────
  // No token: answered with PUBLIC_FIELDS only. This keeps Android app
  // versions already installed (which call this without a token) working
  // until users update; they never receive email/phone/licence number.
  // A token that is present but invalid is refused.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  let caller = null;
  if (token) {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    caller = authData?.user || null;
    if (authError || !caller) {
      console.error('[get-profiles] invalid token:', authError?.message);
      return reply(401, { error: 'Sign in required' });
    }
  }

  // ── Which ids? ─────────────────────────────────────────────────────────────
  let ids;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '{}');
    ({ ids } = JSON.parse(rawBody));
  } catch {
    return reply(400, { error: 'Invalid JSON body' });
  }

  if (!Array.isArray(ids) || ids.length === 0) return reply(400, { error: '`ids` must be a non-empty array' });
  ids = [...new Set(ids)];
  if (ids.length > MAX_IDS) return reply(400, { error: `At most ${MAX_IDS} ids per request` });
  if (!ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
    return reply(400, { error: 'Every id must be a user id (uuid)' });
  }

  try {
    // ── Profiles (all fields we might return; trimmed per target below) ──────
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select([...PUBLIC_FIELDS, ...PRIVATE_FIELDS, 'is_admin'].join(','))
      .in('id', caller ? [...new Set([...ids, caller.id])] : ids);
    if (profilesError) throw profilesError;

    const callerProfile = caller ? profiles.find((p) => p.id === caller.id) : null;
    const callerIsAdmin = !!caller &&
      (caller.user_metadata?.is_admin === true || callerProfile?.is_admin === true);

    // ── Who does the caller have a real relationship with? ───────────────────
    // (Nobody, if there is no signed-in caller.)
    const allowed = new Set(caller ? [caller.id] : []);
    if (caller && !callerIsAdmin) {
      const others = ids.filter((id) => id !== caller.id);
      if (others.length > 0) {
        const list = others.join(',');
        const [rentalsRes, gigsRes] = await Promise.all([
          supabase.from('rentals').select('owner_id, driver_id')
            .or(
              `and(owner_id.eq.${caller.id},driver_id.in.(${list})),` +
              `and(driver_id.eq.${caller.id},owner_id.in.(${list}))`,
            ),
          supabase.from('gig_requests').select('customer_id, driver_id')
            .or(
              `and(customer_id.eq.${caller.id},driver_id.in.(${list})),` +
              `and(driver_id.eq.${caller.id},customer_id.in.(${list}))`,
            ),
        ]);
        if (rentalsRes.error) throw rentalsRes.error;
        if (gigsRes.error) throw gigsRes.error;

        for (const r of rentalsRes.data || []) allowed.add(r.owner_id === caller.id ? r.driver_id : r.owner_id);
        for (const g of gigsRes.data || []) allowed.add(g.customer_id === caller.id ? g.driver_id : g.customer_id);
      }
    }

    // ── Build the response, in the order the ids were asked for ──────────────
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const result = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((p) => {
        const out = {};
        for (const f of PUBLIC_FIELDS) out[f] = p[f];
        if (callerIsAdmin || allowed.has(p.id)) {
          for (const f of PRIVATE_FIELDS) out[f] = p[f];
        }
        return out;
      });

    return reply(200, result);
  } catch (err) {
    console.error('[get-profiles] failed:', err);
    return reply(500, { error: 'Could not load profiles' });
  }
};
