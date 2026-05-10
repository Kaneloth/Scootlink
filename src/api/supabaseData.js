/**
 * Supabase data layer — mirrors the Base44 entity API surface.
 * Tables expected in Supabase: vehicles, rentals, transactions, reviews, profiles
 * The `profiles` table stores extended user data keyed by user id (uuid).
 */
import { supabase } from './supabaseClient';
export { supabase };
import { base44 } from './base44Client';

// ─── Auth helpers ────────────────────────────────────────────────────────────

export const auth = {
  me: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Fetch latest profile data (wallet, rating, total_reviews)
    const { data: profile } = await supabase
      .from('profiles')
      .select('wallet_balance, rating, total_reviews')
      .eq('id', user.id)
      .single();

    return {
      ...user.user_metadata,
      id: user.id,
      email: user.email,
      wallet_balance: profile?.wallet_balance ?? 0,
      rating: profile?.rating ?? 0,
      total_reviews: profile?.total_reviews ?? 0, // profiles table is the source of truth
    };
  },
  updateMe: async (updates) => {
    const { data, error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw error;
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

// ─── File upload via Supabase Storage ────────────────────────────────────────

export const uploadFile = async (file, bucket = 'uploads') => {
  const ext = file.name.split('.').pop();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { file_url: data.publicUrl };
};
