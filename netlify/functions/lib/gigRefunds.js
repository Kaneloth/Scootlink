/**
 * gigRefunds — send a queued gig refund (gig_refunds, migration 018) to PayFast.
 * Place at: netlify/functions/lib/gigRefunds.js
 *
 * Used by admin-payments ("Refund now") and, once app_settings.gig_auto_refunds
 * is switched on, by gig-expiry-check.
 *
 * PayFast's Refunds API does not work in sandbox mode (their own SDK refuses
 * it), so in sandbox this records nothing and returns an explanation: refund
 * in the PayFast dashboard and use "Mark refunded" in admin instead.
 *
 * The amount is sent in cents, as an integer. This has not been confirmed
 * against a live refund yet — do the first live refund on a small amount and
 * check the PayFast dashboard shows exactly that amount.
 */
import { PAYFAST_MODE, payfastApiRequest } from './payfast.js';

export async function sendGigRefund(supabase, refundId, adminId = null) {
  const { data: refund, error: rErr } = await supabase
    .from('gig_refunds')
    .select('id, payment_id, gig_id, customer_id, amount, status')
    .eq('id', refundId)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!refund) return { ok: false, error: 'Refund not found' };
  if (refund.status === 'refunded') return { ok: false, error: 'This refund has already been sent' };

  if (PAYFAST_MODE !== 'live') {
    return {
      ok: false,
      error: "PayFast refunds don't work in sandbox mode. Refund it in the PayFast dashboard, then use Mark refunded.",
    };
  }

  const { data: payment, error: pErr } = await supabase
    .from('platform_payments')
    .select('pf_payment_id, amount')
    .eq('id', refund.payment_id)
    .single();
  if (pErr) throw pErr;
  if (!payment?.pf_payment_id) return { ok: false, error: 'This payment has no PayFast reference' };

  // Claim it (fails if another admin / the scheduler is already sending it)
  const { error: claimErr } = await supabase.rpc('admin_record_refund', {
    p_refund_id: refund.id, p_outcome: 'processing', p_admin_id: adminId,
  });
  if (claimErr) return { ok: false, error: claimErr.message };

  const cents = Math.round(Number(refund.amount) * 100);
  let result;
  try {
    result = await payfastApiRequest('POST', `refunds/${encodeURIComponent(payment.pf_payment_id)}`, {
      json: { amount: cents, reason: `Skootlink gig #${refund.gig_id} refund`, notify_buyer: 1 },
    });
  } catch (err) {
    result = { ok: false, status: 0, body: { error: err.message } };
  }

  // PayFast answers { code, status: 'success' | 'failed', data }; treat a
  // 2xx that doesn't say success as a failure too.
  if (!result.ok || (result.body?.status && String(result.body.status).toLowerCase() !== 'success')) {
    const msg = `PayFast ${result.status}: ${JSON.stringify(result.body).slice(0, 500)}`;
    console.error(`[gigRefunds] refund ${refund.id} failed:`, msg);
    await supabase.rpc('admin_record_refund', {
      p_refund_id: refund.id, p_outcome: 'failed', p_admin_id: adminId, p_error: msg,
    });
    return { ok: false, error: msg };
  }

  const reference = String(result.body?.data?.response?.id || result.body?.data?.id || result.body?.id || '') || null;
  const { error: doneErr } = await supabase.rpc('admin_record_refund', {
    p_refund_id: refund.id, p_outcome: 'refunded', p_admin_id: adminId, p_reference: reference,
  });
  if (doneErr) {
    // PayFast accepted it; only our bookkeeping failed. Say so loudly.
    console.error(`[gigRefunds] refund ${refund.id} SENT but not recorded:`, doneErr);
    return { ok: false, error: `Sent to PayFast but not recorded here: ${doneErr.message}. Use Mark refunded.` };
  }

  await supabase.rpc('create_notification', {
    p_user_id: refund.customer_id,
    p_type: 'gig_refund',
    p_title: 'Refund sent',
    p_body: `R${Number(refund.amount).toFixed(2)} has been refunded to your card. Your bank may take a few days to show it.`,
    p_data: { gig_id: refund.gig_id },
  }).then(({ error }) => { if (error) console.error('[gigRefunds] notify failed:', error); });

  console.log(`[gigRefunds] refund ${refund.id} sent: R${refund.amount} for gig ${refund.gig_id}`);
  return { ok: true, reference };
}
