/**
 * Netlify Function: admin-app-settings
 * Admin-only read/write access to the app_settings table.
 *
 * POST body:
 *   { action: 'get' }
 *   { action: 'toggle_profile_visibility', enabled: boolean }
 *   { action: 'update_signup_credits', driver_credits: number, owner_credits: number }
 *   { action: 'update_verification_prices', sa_id: number, passport: number, licence: number }
 *   { action: 'get_gig_pricing' }
 *   { action: 'update_gig_pricing', commission_percent, ride_minimum_fare, ride_per_km_rate,
 *       delivery_minimum_fare, delivery_per_km_rate }   (all numbers)
 *   (Gig actions are separate from 'get' so the pages using 'get' are
 *   unaffected if migration 010 hasn't run yet.)
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
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { action, enabled, driver_credits, owner_credits, sa_id, passport, licence } = body;

  try {
    if (action === 'get') {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .select('profile_visibility_toggle_enabled, signup_credits_driver, signup_credits_owner, verification_price_sa_id, verification_price_passport, verification_price_licence, updated_at')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    if (action === 'toggle_profile_visibility') {
      if (typeof enabled !== 'boolean') {
        return { statusCode: 400, body: JSON.stringify({ error: 'enabled must be true or false' }) };
      }
      const { error } = await supabaseAdmin
        .from('app_settings')
        .update({
          profile_visibility_toggle_enabled: enabled,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', 1);
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ profile_visibility_toggle_enabled: enabled }) };
    }

    if (action === 'update_signup_credits') {
      const isValidAmount = (n) => Number.isInteger(n) && n >= 0;
      if (!isValidAmount(driver_credits) || !isValidAmount(owner_credits)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'driver_credits and owner_credits must be non-negative integers' }) };
      }
      const { error } = await supabaseAdmin
        .from('app_settings')
        .update({
          signup_credits_driver: driver_credits,
          signup_credits_owner:  owner_credits,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', 1);
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ signup_credits_driver: driver_credits, signup_credits_owner: owner_credits }) };
    }

    if (action === 'update_verification_prices') {
      // Prices are Rand amounts, e.g. 25 or 24.99 — must stay a positive
      // number > 0 (PayFast won't process a R0 charge, and a free
      // "verification" would defeat the point of this being a paid service).
      const isValidPrice = (n) => typeof n === 'number' && isFinite(n) && n > 0;
      if (!isValidPrice(sa_id) || !isValidPrice(passport) || !isValidPrice(licence)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'sa_id, passport, and licence must each be a positive number' }) };
      }
      const { error } = await supabaseAdmin
        .from('app_settings')
        .update({
          verification_price_sa_id:     sa_id,
          verification_price_passport:  passport,
          verification_price_licence:   licence,
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', 1);
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ verification_price_sa_id: sa_id, verification_price_passport: passport, verification_price_licence: licence }) };
    }

    if (action === 'get_gig_pricing') {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .select('gig_commission_percent, ride_minimum_fare, ride_per_km_rate, delivery_minimum_fare, delivery_per_km_rate, updated_at')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    if (action === 'update_gig_pricing') {
      const {
        commission_percent, ride_minimum_fare, ride_per_km_rate,
        delivery_minimum_fare, delivery_per_km_rate,
      } = body;
      const isNum = (n) => typeof n === 'number' && isFinite(n);
      if (!isNum(commission_percent) || commission_percent < 0 || commission_percent > 100) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Commission must be a number from 0 to 100' }) };
      }
      const fares = { ride_minimum_fare, ride_per_km_rate, delivery_minimum_fare, delivery_per_km_rate };
      for (const [k, v] of Object.entries(fares)) {
        if (!isNum(v) || v <= 0) {
          return { statusCode: 400, body: JSON.stringify({ error: `${k} must be a positive number` }) };
        }
      }
      const update = {
        gig_commission_percent: commission_percent,
        ...fares,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      };
      const { error } = await supabaseAdmin.from('app_settings').update(update).eq('id', 1);
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify(update) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('[admin-app-settings] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};