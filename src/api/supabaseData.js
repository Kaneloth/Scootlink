/**
 * Supabase data layer
 * Tables: vehicles, rentals, transactions, reviews, profiles
 * The `profiles` table stores extended user data keyed by user id (uuid).
 */
import { supabase } from './supabaseClient';
export { supabase };

// Key for the biometric session backup in localStorage — declared here so
// auth.logout() can reference it without a forward-reference issue.
const BIOMETRIC_SESSION_KEY = 'scootlink_biometric_session';

// Fields that must be kept in sync between auth metadata and the profiles table.
// profiles is the source of truth — auth metadata is secondary.
const PROFILE_FIELDS = [
  // Subscription
  'subscription_active', 'subscription_plan', 'subscription_start', 'subscription_expires',
  // Identity & verification
  'verified', 'id_document_number', 'id_document_type',
  // Profile
  'full_name', 'email', 'phone', 'location', 'residential_address',
  'gender', 'date_of_birth', 'account_type',
  // Onboarding
  'onboarding_completed', 'customer_code',
  // Licence
  'license_number', 'license_year',
  // Avatar
  'avatar_url', 'avatar_visible',
];

// ─── Auth helpers ────────────────────────────────────────────────────────────

export const auth = {
  me: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // profiles table is the source of truth for all user state.
    // select('*') avoids errors from columns that may not exist yet.
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    // ── Self-healing backfill ──────────────────────────────────────────────
    // Some users were created before email/full_name were written to
    // profiles (pre-dating this fix). Silently backfill on next load so
    // the profiles table catches up without requiring a manual save.
    const backfill = {};
    if (!profile?.email && user.email) backfill.email = user.email;
    if (!profile?.full_name && user.user_metadata?.full_name) backfill.full_name = user.user_metadata.full_name;
    if (Object.keys(backfill).length > 0) {
      supabase.from('profiles').update(backfill).eq('id', user.id).then(({ error }) => {
        if (error) console.warn('[auth.me] backfill failed:', error.message);
      });
    }

    return {
      // auth metadata last (lowest priority — may be stale)
      ...user.user_metadata,
      id: user.id,
      email: profile?.email ?? user.email,
      // profiles table values always win over auth metadata
      wallet_balance:       profile?.wallet_balance       ?? 0,
      rating:               profile?.rating               ?? 0,
      total_reviews:        profile?.total_reviews        ?? 0,
      verified:             profile?.verified             ?? false,
      subscription_active:  profile?.subscription_active  ?? user.user_metadata?.subscription_active ?? false,
      subscription_plan:    profile?.subscription_plan    ?? user.user_metadata?.subscription_plan   ?? null,
      subscription_start:   profile?.subscription_start   ?? user.user_metadata?.subscription_start  ?? null,
      subscription_expires: profile?.subscription_expires ?? user.user_metadata?.subscription_expires ?? null,
      full_name:            profile?.full_name            ?? user.user_metadata?.full_name            ?? null,
      phone:                profile?.phone                ?? user.user_metadata?.phone                ?? null,
      location:             profile?.location             ?? user.user_metadata?.location             ?? null,
      onboarding_completed: profile?.onboarding_completed ?? user.user_metadata?.onboarding_completed ?? false,
      avatar_url:           profile?.avatar_url           ?? user.user_metadata?.avatar_url           ?? null,
      avatar_visible:       profile?.avatar_visible       ?? user.user_metadata?.avatar_visible       ?? true,
      // account_type must always come from profiles — auth metadata JWT can be
      // stale on mobile if the token hasn't refreshed since onboarding wrote it
      account_type:         profile?.account_type         ?? user.user_metadata?.account_type        ?? 'driver',
    };
  },

  updateMe: async (updates) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // 1. Write to profiles FIRST and directly — this is the source of truth.
    //    Writing here before touching auth metadata avoids a race condition
    //    where Supabase's own auth-state-change side effects (or a DB trigger
    //    on auth.users) can re-create/overwrite the profiles row with default
    //    values AFTER our write, silently reverting fields like account_type.
    const profileUpdates = {};
    PROFILE_FIELDS.forEach((k) => {
      if (k in updates) profileUpdates[k] = updates[k];
    });

    // Postgres date/timestamp columns reject empty strings outright —
    // normalise any '' to null so a blank field never breaks the whole save.
    const DATE_FIELDS = ['date_of_birth', 'subscription_start', 'subscription_expires'];
    DATE_FIELDS.forEach((k) => {
      if (profileUpdates[k] === '') profileUpdates[k] = null;
    });

    if (Object.keys(profileUpdates).length > 0) {
      // Try update first (fast path for existing rows)
      let { data: updated, error: updateErr } = await supabase
        .from('profiles')
        .update(profileUpdates)
        .eq('id', user.id)
        .select('id');

      // PGRST204 = "column does not exist in schema cache" — the profiles
      // table is missing a column we tried to write (e.g. date_of_birth,
      // avatar_visible). Strip it out and retry so the REST of the update
      // still goes through instead of failing entirely.
      let retries = 0;
      while (updateErr?.code === 'PGRST204' && retries < 5) {
        const match = updateErr.message?.match(/'([^']+)'\s+column/);
        const badColumn = match?.[1];
        if (!badColumn || !(badColumn in profileUpdates)) break;
        console.warn(`[auth.updateMe] dropping unknown column "${badColumn}" and retrying`);
        delete profileUpdates[badColumn];
        retries++;
        if (Object.keys(profileUpdates).length === 0) break;
        ({ data: updated, error: updateErr } = await supabase
          .from('profiles')
          .update(profileUpdates)
          .eq('id', user.id)
          .select('id'));
      }

      // 22007 = "invalid input syntax for type date/timestamp" — almost
      // always caused by an empty string slipping through. Null out any
      // empty-string values and retry once rather than failing the save.
      if (updateErr?.code === '22007') {
        let changed = false;
        Object.keys(profileUpdates).forEach((k) => {
          if (profileUpdates[k] === '') { profileUpdates[k] = null; changed = true; }
        });
        if (changed) {
          console.warn('[auth.updateMe] empty-string date value detected, nulling and retrying');
          ({ data: updated, error: updateErr } = await supabase
            .from('profiles')
            .update(profileUpdates)
            .eq('id', user.id)
            .select('id'));
        }
      }

      // If no row was updated (brand new user, profiles row doesn't exist yet),
      // insert it explicitly rather than relying on upsert timing.
      // Unique constraint violations (email/phone already in use)
      if (updateErr?.code === '23505') {
        const msg = updateErr.message?.toLowerCase() || '';
        if (msg.includes('email')) throw Object.assign(new Error('An account with this email address already exists.'), { code: '23505' });
        if (msg.includes('phone')) throw Object.assign(new Error('An account with this phone number already exists.'), { code: '23505' });
        throw Object.assign(new Error('This information is already in use by another account.'), { code: '23505' });
      }

      if (!updateErr && (!updated || updated.length === 0) && Object.keys(profileUpdates).length > 0) {
        let insertPayload = { id: user.id, ...profileUpdates };
        let insertErr;
        let insertRetries = 0;
        do {
          ({ error: insertErr } = await supabase.from('profiles').insert(insertPayload));
          if (insertErr?.code === 'PGRST204') {
            const match = insertErr.message?.match(/'([^']+)'\s+column/);
            const badColumn = match?.[1];
            if (badColumn && badColumn in insertPayload) {
              console.warn(`[auth.updateMe] dropping unknown column "${badColumn}" from insert and retrying`);
              const { [badColumn]: _, ...rest } = insertPayload;
              insertPayload = rest;
              insertRetries++;
              continue;
            }
          }
          break;
        } while (insertRetries < 5);
        if (insertErr && insertErr.code !== '23505') { // ignore duplicate-key races
          console.error('[auth.updateMe] profiles insert failed:', insertErr);
        }
      } else if (updateErr) {
        console.error('[auth.updateMe] profiles update failed:', updateErr);
      }
    }

    // 2. Update auth metadata AFTER profiles is confirmed written —
    //    this keeps the JWT in sync but profiles remains the source of truth.
    const { data, error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw error;

    return data;
  },

  logout: async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch { /* non-fatal */ }

    // Manually wipe all Supabase auth keys from localStorage
    // so the next getSession() call never reads a stale session
    try {
      const keysToRemove = Object.keys(localStorage).filter(k =>
        k.startsWith('sb-') || k.includes('supabase') || k === BIOMETRIC_SESSION_KEY
      );
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }

    try { sessionStorage.clear(); } catch { /* ignore */ }

    // Longer delay on mobile — give the browser time to flush storage
    // before App.jsx runs getSession() on the new page load
    setTimeout(() => { window.location.replace('/auth'); }, 500);
  },

  isAuthenticated: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return !!user;
  },
};

// ─── Generic entity helpers ──────────────────────────────────────────────────

const entity = (table) => ({
  list: async (orderCol = 'created_at', limit = 50) => {
    const col = orderCol.startsWith('-') ? orderCol.slice(1) : orderCol;
    const asc = !orderCol.startsWith('-');
    const { data, error } = await supabase.from(table).select('*').order(col, { ascending: asc }).limit(limit);
    if (error) throw error;
    return data || [];
  },
  filter: async (filters = {}, orderCol = '-created_at', limit = 100) => {
    const col = orderCol.startsWith('-') ? orderCol.slice(1) : orderCol;
    const asc = !orderCol.startsWith('-');
    let q = supabase.from(table).select('*');
    Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); });
    const { data, error } = await q.order(col, { ascending: asc }).limit(limit);
    if (error) throw error;
    return data || [];
  },
  get: async (id) => {
    const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
  create: async (payload) => {
    const { data: { user } } = await supabase.auth.getUser();
    const row = { ...payload, owner_id: user?.id };
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) throw new Error(`${error.message} (code: ${error.code}, details: ${error.details})`);
    return data;
  },
  update: async (id, payload) => {
    const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  delete: async (id) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
  },
});

// ─── Exported entities ───────────────────────────────────────────────────────

// Column mapping: app field → Supabase column
const vehicleToDb = (v) => {
  const mapped = { ...v };
  if ('vehicle_type' in mapped) { mapped.type = mapped.vehicle_type; delete mapped.vehicle_type; }
  if ('price_per_week' in mapped) { mapped.price = mapped.price_per_week; delete mapped.price_per_week; }
  return mapped;
};
const vehicleFromDb = (v) => {
  if (!v) return v;
  const mapped = { ...v };
  if ('type' in mapped) { mapped.vehicle_type = mapped.type; delete mapped.type; }
  if ('price' in mapped) { mapped.price_per_week = mapped.price; delete mapped.price; }
  return mapped;
};

const _vehicleEntity = entity('vehicles');
export const Vehicle = {
  list: async (...args) => (await _vehicleEntity.list(...args)).map(vehicleFromDb),
  filter: async (...args) => (await _vehicleEntity.filter(...args)).map(vehicleFromDb),
  get: async (id) => vehicleFromDb(await _vehicleEntity.get(id)),
  create: async (payload) => vehicleFromDb(await _vehicleEntity.create(vehicleToDb(payload))),
  update: async (id, payload) => vehicleFromDb(await _vehicleEntity.update(id, vehicleToDb(payload))),
  delete: async (id) => _vehicleEntity.delete(id),
};
export const Rental      = entity('rentals');
export const Transaction = entity('transactions');
export const Review      = entity('reviews');
export const User        = {
  ...entity('profiles'),
  list: async () => {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) throw error;
    return data || [];
  },
};

// ─── Biometric session backup ─────────────────────────────────────────────────
// Stores both tokens so setSession() can restore the session directly.
// Supabase JS v2 automatically refreshes an expired access_token using the
// refresh_token inside setSession(), so stale access_tokens are handled safely.

export function saveBiometricRefreshToken(session) {
  if (!session?.refresh_token) return;
  try {
    localStorage.setItem(BIOMETRIC_SESSION_KEY, JSON.stringify({
      access_token:  session.access_token  || '',
      refresh_token: session.refresh_token,
    }));
  } catch { /* storage full — non-fatal */ }
}

export function loadBiometricRefreshToken() {
  try {
    const raw = localStorage.getItem(BIOMETRIC_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearBiometricRefreshToken() {
  try { localStorage.removeItem(BIOMETRIC_SESSION_KEY); } catch { /* ignore */ }
}

// Auto-keep the backup in sync with Supabase's own token rotation.
// Supabase JS v2 rotates refresh tokens on every use. Without this listener,
// any token saved at login time is stale by the time biometric login runs.
// This fires on: initial session load, every auto-refresh, and manual sign-in.
supabase.auth.onAuthStateChange((event, session) => {
  if (
    (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') &&
    session?.refresh_token
  ) {
    try {
      localStorage.setItem(BIOMETRIC_SESSION_KEY, JSON.stringify({
        access_token:  session.access_token  || '',
        refresh_token: session.refresh_token,
      }));
    } catch { /* full */ }
  }
});

// ─── Avatar-aware profile fetcher ────────────────────────────────────────────
// Uses the Netlify service-role function so avatar_url is resolved from auth
// user_metadata for users who haven't re-saved their profile since the fix.
// Falls back to a direct profiles query if the function isn't available.
export const fetchProfilesByIds = async (ids) => {
  if (!ids || ids.length === 0) return [];
  try {
    const res = await fetch('/.netlify/functions/get-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error('Function unavailable');
    return await res.json();
  } catch {
    // Fallback: direct profiles query (avatar_url from DB, no auth metadata merge)
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, avatar_visible')
      .in('id', ids);
    return data || [];
  }
};

// ─── File upload via Supabase Storage ────────────────────────────────────────

export const uploadFile = async (file, bucket = 'uploads') => {
  const ext = file.name.split('.').pop();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { file_url: data.publicUrl };
};
