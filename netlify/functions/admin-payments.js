/**
 * Netlify Function: admin-payments
 * Admin-only: gig refunds and driver payouts (migration 018).
 *
 * POST body:
 *   { action: 'overview' }
 *   { action: 'refund_now', refundId }                 send a queued refund through PayFast (live mode only)
 *   { action: 'mark_refunded', refundId, reference }   refund done by hand in the PayFast dashboard
 *   { action: 'settle_payout', withdrawalId, outcome: 'processing' | 'paid' | 'rejected', note }
 *                                                      note = EFT reference (paid) or reason (rejected)
 *   { action: 'update_settings', gig_auto_refunds?, gig_min_payout?, gig_payment_window_minutes? }
 * Auth: Bearer token of an admin (user_metadata.is_admin === true), as in the other admin-* functions.
 */
import { createClient } from '@supabase/supabase-js';
import { sendGigRefund } from './lib/gigRefunds.js';
import { PAYFAST_MODE } from './lib/payfast.js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const reply = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });

async function notify(userId, type, title, body, data = null) {
  if (!userId) return;
  const { error } = await supabaseAdmin.rpc('create_notification', {
    p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
  });
  if (error) console.error('[admin-payments] notify failed:', error.message);
}

async function namesFor(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', unique);
  if (error) throw error;
  return Object.fromEntries((data || []).map((p) => [p.id, p]));
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return reply(401, { error: 'Missing authorization token' });
  const { data: { user } = {}, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || user.user_metadata?.is_admin !== true) {
    return reply(403, { error: 'Admin access required' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON' }); }

  try {
    if (body.action === 'overview') {
      const [refundsRes, payoutsRes, settingsRes, paidRes] = await Promise.all([
        supabaseAdmin.from('gig_refunds')
          .select('id, gig_id, customer_id, amount, status, attempts, last_error, provider_reference, created_at, processed_at')
          .order('created_at', { ascending: false }).limit(100),
        supabaseAdmin.from('withdrawal_requests')
          .select('id, driver_id, amount, status, bank_account_holder, bank_name, bank_account_number, bank_branch_code, bank_account_type, requested_at, processed_at, payment_reference, rejection_reason')
          .order('requested_at', { ascending: false }).limit(100),
        supabaseAdmin.from('app_settings')
          .select('gig_auto_refunds, gig_min_payout, gig_payment_window_minutes').eq('id', 1).single(),
        supabaseAdmin.from('platform_payments')
          .select('amount').eq('kind', 'gig_fare').eq('status', 'paid')
          .gte('paid_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
      ]);
      for (const r of [refundsRes, payoutsRes, settingsRes, paidRes]) if (r.error) throw r.error;

      const names = await namesFor([
        ...(refundsRes.data || []).map((r) => r.customer_id),
        ...(payoutsRes.data || []).map((p) => p.driver_id),
      ]);
      return reply(200, {
        mode: PAYFAST_MODE,
        settings: settingsRes.data,
        gigFaresLast30Days: (paidRes.data || []).reduce((t, p) => t + Number(p.amount), 0),
        refunds: (refundsRes.data || []).map((r) => ({ ...r, customer: names[r.customer_id] || null })),
        payouts: (payoutsRes.data || []).map((p) => ({ ...p, driver: names[p.driver_id] || null })),
      });
    }

    if (body.action === 'refund_now') {
      const out = await sendGigRefund(supabaseAdmin, Number(body.refundId), user.id);
      return reply(out.ok ? 200 : 400, out.ok ? { ok: true, reference: out.reference } : { error: out.error });
    }

    if (body.action === 'mark_refunded') {
      const reference = String(body.reference || '').trim();
      if (!reference) return reply(400, { error: 'Enter the PayFast refund reference' });
      const { data: ref, error } = await supabaseAdmin.rpc('admin_record_refund', {
        p_refund_id: Number(body.refundId), p_outcome: 'refunded', p_admin_id: user.id, p_reference: reference,
      });
      if (error) return reply(400, { error: error.message });
      await notify(ref.customer_id, 'gig_refund', 'Refund sent',
        `R${Number(ref.amount).toFixed(2)} has been refunded to you. Your bank may take a few days to show it.`, { gig_id: ref.gig_id });
      return reply(200, { ok: true });
    }

    if (body.action === 'settle_payout') {
      const { data: w, error } = await supabaseAdmin.rpc('admin_settle_payout', {
        p_withdrawal_id: Number(body.withdrawalId), p_outcome: body.outcome, p_admin_id: user.id, p_note: body.note || null,
      });
      if (error) return reply(400, { error: error.message });
      if (body.outcome === 'paid') {
        await notify(w.driver_id, 'payout_paid', 'Payout sent',
          `R${Number(w.amount).toFixed(2)} has been paid to your bank account. Reference: ${w.payment_reference}.`, null);
      } else if (body.outcome === 'rejected') {
        await notify(w.driver_id, 'payout_rejected', 'Payout not sent',
          `Your payout of R${Number(w.amount).toFixed(2)} was not sent: ${w.rejection_reason}. The money is back in your available balance.`, null);
      }
      return reply(200, { ok: true });
    }

    if (body.action === 'update_settings') {
      const patch = {};
      if (typeof body.gig_auto_refunds === 'boolean') patch.gig_auto_refunds = body.gig_auto_refunds;
      if (body.gig_min_payout != null) {
        const v = Number(body.gig_min_payout);
        if (!(v >= 0 && v <= 100000)) return reply(400, { error: 'Minimum payout must be between R0 and R100 000' });
        patch.gig_min_payout = Math.round(v * 100) / 100;
      }
      if (body.gig_payment_window_minutes != null) {
        const v = Number(body.gig_payment_window_minutes);
        if (!(Number.isInteger(v) && v >= 5 && v <= 240)) return reply(400, { error: 'Payment window must be 5 to 240 minutes' });
        patch.gig_payment_window_minutes = v;
      }
      if (!Object.keys(patch).length) return reply(400, { error: 'Nothing to update' });
      if (patch.gig_auto_refunds === true && PAYFAST_MODE !== 'live') {
        return reply(400, { error: "Automatic refunds need PayFast live mode (refunds don't work in sandbox)" });
      }
      const { error } = await supabaseAdmin.from('app_settings')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: user.id }).eq('id', 1);
      if (error) throw error;
      return reply(200, { ok: true });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (err) {
    console.error('[admin-payments] error:', err);
    return reply(500, { error: err.message || 'Something went wrong' });
  }
};
