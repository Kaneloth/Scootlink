/**
 * Netlify Function: gig-checkout
 * "Pay now" again for a card gig that is still waiting for payment (the
 * customer closed PayFast, or the payment failed). Builds a fresh PayFast
 * form; see lib/gigCheckout.js.
 *
 * Before taking money it checks that at least one eligible driver is online
 * within the widest search radius. If none is, it answers 409 { no_drivers }
 * and the customer is not charged — a refund after "no driver found" costs
 * Skootlink PayFast's fee (about R2.30 on a R15 fare, seen live 2026-10-18).
 * If the check itself fails, payment goes ahead (the normal refund covers it).
 *
 * POST body: { gig_id: number, is_native?: boolean }
 * Auth: Bearer token — must be the gig's customer.
 */
import { createClient } from '@supabase/supabase-js';
import { createGigCheckout } from './lib/gigCheckout.js';
import { EXPANDED_RADIUS_METERS } from './lib/gigMatching.js';

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

  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '').trim();
  if (!jwt) return reply(401, { error: 'Missing Authorization header' });
  const { data: { user } = {}, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) return reply(401, { error: 'Invalid or expired session' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON' }); }

  const gigId = Number(body.gig_id);
  if (!Number.isInteger(gigId) || gigId <= 0) return reply(400, { error: 'gig_id is required' });

  try {
    const { data: gig, error } = await supabase
      .from('gig_requests')
      .select('id, customer_id, gig_type, status, fare_amount, pickup_address, dropoff_address')
      .eq('id', gigId)
      .maybeSingle();
    if (error) throw error;
    if (!gig || gig.customer_id !== user.id) return reply(404, { error: 'Gig not found' });
    if (gig.status !== 'awaiting_payment') {
      return reply(409, { error: 'This request is no longer waiting for payment', status: gig.status });
    }

    // Anyone able to take it right now? (same rules as the real search)
    const { data: drivers, error: matchErr } = await supabase.rpc('find_nearby_eligible_drivers', {
      p_gig_id: gig.id, p_radius_meters: EXPANDED_RADIUS_METERS,
    });
    if (matchErr) {
      console.error(`[gig-checkout] driver check failed for gig=${gig.id}; letting payment proceed:`, matchErr);
    } else if (!drivers || drivers.length === 0) {
      console.log(`[gig-checkout] gig=${gig.id}: no eligible drivers online within ${EXPANDED_RADIUS_METERS}m; not charging`);
      return reply(409, {
        no_drivers: true,
        error: 'No drivers are available near your pickup right now. You have not been charged — please try again in a few minutes.',
      });
    }

    const payment = await createGigCheckout(supabase, user, gig, body.is_native === true, event.headers || {});
    return reply(200, { payment });
  } catch (err) {
    console.error('[gig-checkout] failed:', err);
    return reply(500, { error: 'Payment could not be started. Please try again.' });
  }
};