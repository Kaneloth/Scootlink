/**
 * Supabase data layer — mirrors the Base44 entity API surface.
 * Tables expected in Supabase: vehicles, rentals, transactions, reviews, profiles
 * The `profiles` table stores extended user data keyed by user id (uuid).
 */
import { supabase } from './supabaseClient';
export { supabase };
import { base44 } from './base44Client';

// Fields that must be kept in sync between auth metadata and the profiles table.
// profiles is the source of truth — auth metadata is secondary.
const PROFILE_FIELDS = [
  'subscription_active', 'subscription_plan', 'subscription_start',
  'subscription_expires', 'verified', 'full_name', 'phone', 'location',
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

    return {
      // auth metadata last (lowest priority — may be stale)
      ...user.user_metadata,
      id: user.id,
      email: user.email,
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
    };
  },

  updateMe: async (updates) => {
    // 1. Write to Supabase auth metadata (keeps auth token in sync)
    const { data, error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw error;

    // 2. Sync relevant fields to profiles table so auth.me() always reads
    //    the latest values regardless of token refresh timing.
    const profileUpdates = {};
    PROFILE_FIELDS.forEach((k) => {
      if (k in updates) profileUpdates[k] = updates[k];
    });
    if (Object.keys(profileUpdates).length > 0) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update(profileUpdates).eq('id', user.id);
      }
    }

    return data;
  },

  logout: async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
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
const BIOMETRIC_SESSION_KEY = 'scootlink_biometric_session';

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
