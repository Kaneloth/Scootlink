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
 * { check_only: true } runs just that check and returns counts
 * { drivers_available, cash_drivers_available } (nothing about who or where),
 * so the status page can show "N drivers nearby" before offering payment.
 *
 * { method: 'cash' } (migration 020): no PayFast. If a driver who takes cash
 * is online, the gig switches to cash and is offered to those drivers only.
 *
 * POST body: { gig_id: number, is_native?: boolean, check_only?: boolean, method?: 'card' | 'cash' }
 * Auth: Bearer token — must be the gig's customer.
 */
import { createClient } from '@supabase/supabase-js';
import { createGigCheckout } from './lib/gigCheckout.js';
import { EXPANDED_RADIUS_METERS, DEFAULT_RADIUS_METERS, offerGigToDrivers } from './lib/gigMatching.js';

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

    // Anyone able to take it right now? (same rules as the real search, by method)
    const { data: countRows, error: matchErr } = await supabase.rpc('gig_driver_counts', {
      p_gig_id: gig.id, p_radius_meters: EXPANDED_RADIUS_METERS,
    });
    const counts = (countRows && countRows[0]) || null;

    if (body.check_only === true) {
      if (matchErr || !counts) {
        console.error(`[gig-checkout] availability check failed for gig=${gig.id}:`, matchErr);
        return reply(200, { drivers_available: null, cash_drivers_available: null }); // unknown: card payment still allowed
      }
      return reply(200, { drivers_available: counts.card_drivers, cash_drivers_available: counts.cash_drivers });
    }

    // ── Cash: no PayFast; start searching among drivers who take cash ──────
    if (body.method === 'cash') {
      if (matchErr || !counts) {
        console.error(`[gig-checkout] cash driver check failed for gig=${gig.id}:`, matchErr);
        return reply(503, { error: 'Could not check for drivers. Please try again.' });
      }
      if (counts.cash_drivers === 0) {
        return reply(409, {
          no_drivers: true,
          error: 'No drivers who take cash are available near your pickup right now. Try again shortly, or pay by card.',
        });
      }
      const { data: started, error: startErr } = await supabase.rpc('start_cash_gig', { p_gig_id: gig.id, p_customer: user.id });
      if (startErr) return reply(409, { error: startErr.message });
      const { notified, pushed } = await offerGigToDrivers(supabase, started, DEFAULT_RADIUS_METERS, 'gig-checkout');
      console.log(`[gig-checkout] gig=${gig.id} cash; offered to ${notified} driver(s), ${pushed} push(es)`);
      return reply(200, { cash: true, gig: started });
    }

    if (matchErr || !counts) {
      console.error(`[gig-checkout] driver check failed for gig=${gig.id}; letting payment proceed:`, matchErr);
    } else if (counts.card_drivers === 0) {
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
