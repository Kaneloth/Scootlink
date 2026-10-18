/**
 * Netlify Function: play-listing
 * The listing fee in the Android app, paid with Google Play Billing
 * (migration 022). The web pays the same fee through PayFast (listing-checkout).
 *
 * POST body:
 *   { action: 'start', vehicle_id }
 *       -> { ref, product_id }   ref goes to Google as the purchase's
 *          appAccountToken (obfuscated account id), tying it to this vehicle
 *   { action: 'verify', purchase_token, product_id? }
 *       -> { status: 'activated' | 'already_done' | 'pending' | 'refund_due', vehicle_id }
 *          Reads the purchase from Google, activates/extends the listing,
 *          then consumes the purchase (so it can be bought again, and so
 *          Google doesn't refund it as unacknowledged after 3 days).
 *          Safe to repeat: the app re-sends unfinished purchases on start.
 * Auth: Bearer token — the vehicle's owner.
 */
import { createClient } from '@supabase/supabase-js';
import {
  PLAY_LISTING_PRODUCT_ID, isPlayConfigured, getProductPurchase, consumeProductPurchase,
} from './lib/googlePlay.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

async function notify(userId, type, title, body, data) {
  const { error } = await supabase.rpc('create_notification', {
    p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
  });
  if (error) console.error('[play-listing] notify failed:', error.message);
}

async function start(user, body) {
  const vehicleId = Number(body.vehicle_id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) return reply(400, { error: 'vehicle_id is required' });

  const [{ data: vehicle, error: vErr }, { data: settings, error: sErr }] = await Promise.all([
    supabase.from('vehicles').select('id, owner_id, listing_purpose').eq('id', vehicleId).maybeSingle(),
    supabase.from('app_settings').select('listing_fee').eq('id', 1).single(),
  ]);
  if (vErr) throw vErr;
  if (sErr) throw sErr;
  if (!vehicle || vehicle.owner_id !== user.id) return reply(404, { error: 'Vehicle not found' });
  if (!['rental', 'both'].includes(vehicle.listing_purpose)) {
    return reply(409, { error: 'This vehicle is not listed for rental. Change what it is for first.' });
  }

  // Google allows 64 characters for the account id
  const ref = `play_list_${vehicleId}_${Date.now()}`;
  const { error: payErr } = await supabase.from('platform_payments').insert({
    user_id: user.id, kind: 'listing_fee', vehicle_id: vehicleId, provider: 'google_play',
    amount: Math.max(Number(settings?.listing_fee ?? 149), 0.01), m_payment_id: ref,
  });
  if (payErr) throw payErr;
  console.log(`[play-listing] start owner=${user.id} vehicle=${vehicleId} ref=${ref}`);
  return reply(200, { ref, product_id: PLAY_LISTING_PRODUCT_ID });
}

async function verify(user, body) {
  const token = String(body.purchase_token || '').trim();
  if (!token) return reply(400, { error: 'purchase_token is required' });
  const productId = PLAY_LISTING_PRODUCT_ID;
  if (body.product_id && body.product_id !== productId) return reply(400, { error: 'Unknown product' });

  let purchase;
  try {
    purchase = await getProductPurchase(productId, token);
  } catch (err) {
    console.error('[play-listing] purchase lookup failed:', err.message);
    // 400/404 from Google: not a real purchase of this product
    if (err.status === 400 || err.status === 404 || err.status === 410) return reply(400, { error: 'Google Play did not recognise this purchase' });
    return reply(502, { error: 'Could not reach Google Play. Your purchase is safe — open this page again in a moment.' });
  }

  if (purchase.purchaseState === 2) return reply(200, { status: 'pending' });
  if (purchase.purchaseState !== 0) return reply(409, { error: 'This purchase was cancelled' });

  const { data: rows, error } = await supabase.rpc('mark_listing_play_paid', {
    p_m_payment_id: purchase.obfuscatedExternalAccountId || '',
    p_user_id: user.id,
    p_purchase_token: token,
    p_order_id: purchase.orderId || null,
    p_test: purchase.purchaseType === 0,
  });
  if (error) throw error;
  const { vehicle_id: vehicleId, owner_id: ownerId, action } = (rows && rows[0]) || {};
  console.log(`[play-listing] verify user=${user.id} order=${purchase.orderId} ref=${purchase.obfuscatedExternalAccountId} vehicle=${vehicleId} action=${action}${purchase.purchaseType === 0 ? ' (test)' : ''}`);

  if (action === 'unknown') {
    // Not this user's purchase (or a purchase made without our reference):
    // leave it unconsumed so its owner can still finish it.
    return reply(404, { error: 'This purchase does not belong to one of your vehicles' });
  }
  if (action === 'duplicate' && ownerId && ownerId !== user.id) {
    return reply(404, { error: 'This purchase does not belong to one of your vehicles' });
  }

  // Recorded: consume it now (Google auto-refunds an unacknowledged purchase after 3 days)
  if (purchase.consumptionState !== 1) {
    try {
      await consumeProductPurchase(productId, token);
    } catch (err) {
      // The app retries unfinished purchases; recorded already, so a retry is a duplicate
      console.error(`[play-listing] consume failed (will retry from the app) token=…${token.slice(-8)}:`, err.message);
    }
  }

  if (action === 'activated') {
    await notify(ownerId, 'listing_active', 'Your vehicle is listed',
      'Payment received — your vehicle is now visible to drivers.', { vehicle_id: vehicleId });
    return reply(200, { status: 'activated', vehicle_id: vehicleId });
  }
  if (action === 'duplicate') return reply(200, { status: 'already_done', vehicle_id: vehicleId });

  // vehicle_missing / not_rental: paid, but nothing to list
  console.error(`[play-listing] LISTING FEE NEEDS A REFUND IN PLAY CONSOLE: ${action} order=${purchase.orderId} vehicle=${vehicleId}`);
  return reply(200, { status: 'refund_due', vehicle_id: vehicleId });
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  if (!isPlayConfigured()) return reply(500, { error: 'Google Play payments are not configured' });

  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '').trim();
  if (!jwt) return reply(401, { error: 'Missing Authorization header' });
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) return reply(401, { error: 'Invalid or expired session' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON' }); }

  try {
    if (body.action === 'start') return await start(user, body);
    if (body.action === 'verify') return await verify(user, body);
    return reply(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('[play-listing] failed:', err);
    return reply(500, { error: 'Something went wrong. If you paid, open this page again — your purchase is safe.' });
  }
};
