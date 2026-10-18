/**
 * gigRefunds — send a queued gig refund (gig_refunds, migrations 018/019) to PayFast.
 * Place at: netlify/functions/lib/gigRefunds.js
 *
 * Used by admin-payments ("Refund now") and, once app_settings.gig_auto_refunds
 * is switched on, by gig-expiry-check.
 *
 * PayFast decides per payment how a refund is paid, so (as its docs require)
 * we ask first: GET /refunds/:pf_payment_id returns a method for a full and a
 * partial refund:
 *   PAYMENT_SOURCE -> POST the refund; it goes back to the card
 *   BANK_PAYOUT    -> needs the customer's bank details (refund_bank_accounts).
 *                     If they haven't given them, the refund waits as
 *                     'needs_bank_details' with PayFast's bank list, and the
 *                     customer is asked on the gig screen.
 *   NOT_AVAILABLE  -> recorded as failed with PayFast's reason
 * Amounts are integers in cents (PayFast API docs).
 *
 * Refunds don't work in sandbox mode; there this records nothing and explains.
 */
import { PAYFAST_MODE, payfastApiRequest } from './payfast.js';

const payload = (body) => body?.data?.response ?? body?.data ?? body ?? {};

async function notify(supabase, userId, type, title, body, data) {
  const { error } = await supabase.rpc('create_notification', {
    p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
  });
  if (error) console.error('[gigRefunds] notify failed:', error);
}

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

  const record = (outcome, extra = {}) => supabase.rpc('admin_record_refund', {
    p_refund_id: refund.id, p_outcome: outcome, p_admin_id: adminId, ...extra,
  });
  const fail = async (msg, extra = {}) => {
    console.error(`[gigRefunds] refund ${refund.id} failed:`, msg);
    await record('failed', { p_error: msg, ...extra });
    return { ok: false, error: msg };
  };
  const pfPath = `refunds/${encodeURIComponent(payment.pf_payment_id)}`;
  const cents = Math.round(Number(refund.amount) * 100);

  // ── 1. Ask PayFast how this refund can be paid ────────────────────────────
  let q;
  try { q = await payfastApiRequest('GET', pfPath); }
  catch (err) { return fail(`PayFast refund query failed: ${err.message}`); }
  if (!q.ok) return fail(`PayFast refund query ${q.status}: ${JSON.stringify(q.body).slice(0, 500)}`);
  const info = payload(q.body);
  const available = Number(info.amount_available_for_refund);
  const isFull = Number.isFinite(available) ? cents >= available : cents >= Math.round(Number(payment.amount) * 100);
  const option = (isFull ? info.refund_full : info.refund_partial) || {};
  const method = String(option.method || '').toUpperCase() || null;
  const funding = info.funding_type || null;
  const meta = { p_method: method, p_funding_type: funding };

  if (String(info.status || '').toUpperCase() === 'NOT_AVAILABLE' || method === 'NOT_AVAILABLE' || !method) {
    const why = (info.errors || []).join(' ') || 'PayFast says this payment cannot be refunded through the API';
    return fail(`Not refundable via PayFast (${isFull ? 'full' : 'partial'}): ${why}`, meta);
  }
  if (Number.isFinite(available) && cents > available) {
    return fail(`PayFast has only R${(available / 100).toFixed(2)} left to refund on this payment`, meta);
  }

  const body = { amount: cents, reason: `Skootlink gig #${refund.gig_id} refund`, notify_buyer: 1 };

  // ── 2. Bank payout: needs the customer's bank details ─────────────────────
  if (method === 'BANK_PAYOUT') {
    const banks = Array.isArray(info.bank_names) ? info.bank_names.filter((b) => b && b.bank_name) : [];
    const { data: acct, error: aErr } = await supabase
      .from('refund_bank_accounts').select('*').eq('user_id', refund.customer_id).maybeSingle();
    if (aErr) throw aErr;
    const bankOk = acct && (!banks.length || banks.some((b) => b.bank_name === acct.bank_name));
    if (!bankOk) {
      const msg = acct
        ? 'The bank the customer chose is not on PayFast\'s list; waiting for them to pick again'
        : `PayFast pays this ${isFull ? 'full' : 'partial'} refund into a bank account; waiting for the customer's bank details`;
      await record('needs_bank_details', { p_error: msg, ...meta, p_bank_options: banks });
      await notify(supabase, refund.customer_id, 'gig_refund_details', 'Add your bank details for your refund',
        `Your refund of R${Number(refund.amount).toFixed(2)} will be paid into your bank account. Tap to add your account details.`,
        { gig_id: refund.gig_id });
      return { ok: false, needsBankDetails: true, error: msg };
    }
    Object.assign(body, {
      bank_account_holder: acct.account_holder,
      bank_name: acct.bank_name,
      bank_branch_code: acct.branch_code,
      bank_account_number: acct.account_number,
      bank_account_type: acct.account_type,
    });
  }

  // ── 3. Send it ─────────────────────────────────────────────────────────────
  let result;
  try { result = await payfastApiRequest('POST', pfPath, { json: body }); }
  catch (err) { result = { ok: false, status: 0, body: { error: err.message } }; }

  // PayFast answers { code, status: 'success' | 'failed' | 'error', data }; treat
  // a 2xx that doesn't say success as a failure too.
  if (!result.ok || (result.body?.status && String(result.body.status).toLowerCase() !== 'success')) {
    return fail(`PayFast ${result.status}: ${JSON.stringify(result.body).slice(0, 500)}`, meta);
  }

  const r = payload(result.body);
  const reference = String(r?.instruction_token || r?.id || result.body?.id || '') || null;
  const { error: doneErr } = await record('refunded', { p_reference: reference, ...meta });
  if (doneErr) {
    // PayFast accepted it; only our bookkeeping failed. Say so loudly.
    console.error(`[gigRefunds] refund ${refund.id} SENT but not recorded:`, doneErr);
    return { ok: false, error: `Sent to PayFast but not recorded here: ${doneErr.message}. Use Mark refunded.` };
  }

  await notify(supabase, refund.customer_id, 'gig_refund', 'Refund sent',
    method === 'BANK_PAYOUT'
      ? `R${Number(refund.amount).toFixed(2)} is being paid into your bank account. It may take a few working days.`
      : `R${Number(refund.amount).toFixed(2)} has been refunded to your card. Your bank may take a few days to show it.`,
    { gig_id: refund.gig_id });

  console.log(`[gigRefunds] refund ${refund.id} sent (${method}): R${refund.amount} for gig ${refund.gig_id}`);
  return { ok: true, reference, method };
}
