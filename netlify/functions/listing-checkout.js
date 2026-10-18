/**
 * Netlify Function: listing-checkout
 * The owner pays the listing fee for a vehicle listed for rental
 * (migration 021): one listing period (default 6 months) per payment, used
 * for the first listing and for every relist. Fee and period come from
 * app_settings, never from the app.
 *
 * ITN (payfast-webhook): custom_str3 = 'listing_fee' -> mark_listing_fee_paid()
 * activates the listing (or extends it, if paid before it ends).
 *
 * Not offered in the Android app: Google Play requires its own billing for
 * this kind of purchase, and the app may not point people elsewhere to pay.
 *
 * POST body: { vehicle_id: number }
 * Auth: Bearer token — the vehicle's owner.
 */
import { createClient } from '@supabase/supabase-js';
import { generateSignature, PAYFAST_PROCESS_URL, appBaseUrl, payfastNotifyUrl } from './lib/payfast.js';

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

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };

  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  if (!merchantId || !merchantKey) return reply(500, { error: 'Payments are not configured' });

  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '').trim();
  if (!jwt) return reply(401, { error: 'Missing Authorization header' });
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) return reply(401, { error: 'Invalid or expired session' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON' }); }
  const vehicleId = Number(body.vehicle_id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) return reply(400, { error: 'vehicle_id is required' });

  try {
    const [{ data: vehicle, error: vErr }, { data: settings, error: sErr }] = await Promise.all([
      supabase.from('vehicles').select('id, owner_id, make, model, plate, listing_purpose, listing_state, expires_at').eq('id', vehicleId).maybeSingle(),
      supabase.from('app_settings').select('listing_fee, listing_period_months').eq('id', 1).single(),
    ]);
    if (vErr) throw vErr;
    if (sErr) throw sErr;
    if (!vehicle || vehicle.owner_id !== user.id) return reply(404, { error: 'Vehicle not found' });
    if (!['rental', 'both'].includes(vehicle.listing_purpose)) {
      return reply(409, { error: 'This vehicle is not listed for rental. Change what it is for first.' });
    }
    const fee = Math.round(Number(settings.listing_fee ?? 149) * 100) / 100;
    const months = Number(settings.listing_period_months ?? 6);
    if (!(fee >= 5)) return reply(500, { error: 'The listing fee is not set up correctly' });

    const m_payment_id = `list_${vehicleId}_${Date.now()}`;
    const { error: payErr } = await supabase.from('platform_payments').insert({
      user_id: user.id, kind: 'listing_fee', vehicle_id: vehicleId, amount: fee, m_payment_id,
    });
    if (payErr) throw payErr;

    const headers = event.headers || {};
    const base = appBaseUrl(headers);
    const label = `${vehicle.make} ${vehicle.model}${vehicle.plate ? ` (${vehicle.plate})` : ''}`;
    const fields = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: `${base}/vehicle-listing/${vehicleId}?payment=success`,
      cancel_url: `${base}/vehicle-listing/${vehicleId}?payment=cancelled`,
      notify_url: payfastNotifyUrl(headers),
      name_first: (user.user_metadata?.full_name || 'Skootlink').split(' ')[0],
      email_address: user.email,
      m_payment_id,
      amount: fee.toFixed(2),
      item_name: `Skootlink listing: ${label}`.slice(0, 100),
      item_description: `${months}-month rental listing, including the rental agreement`.slice(0, 255),
      custom_str1: user.id,
      custom_str2: String(vehicleId),
      custom_str3: 'listing_fee',
      custom_str4: 'skootlink',
    };
    const signature = generateSignature(fields, process.env.PAYFAST_PASSPHRASE || '');
    console.log(`[listing-checkout] owner=${user.id} vehicle=${vehicleId} fee=R${fields.amount} m_payment_id=${m_payment_id}`);
    return reply(200, { payment: { action_url: PAYFAST_PROCESS_URL, fields: { ...fields, signature } }, fee, months });
  } catch (err) {
    console.error('[listing-checkout] failed:', err);
    return reply(500, { error: 'Payment could not be started. Please try again.' });
  }
};
