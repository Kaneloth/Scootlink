/**
 * gigCheckout — a signed PayFast payment form for a card gig's fare.
 * Place at: netlify/functions/lib/gigCheckout.js
 *
 * Each attempt gets its own platform_payments row and m_payment_id, so paying
 * twice can never double-charge silently: the second ITN finds the gig no
 * longer waiting and mark_gig_fare_paid queues a full refund for it.
 *
 * ITN fields used by payfast-webhook:
 *   custom_str1 = customer id, custom_str2 = gig id,
 *   custom_str3 = 'gig_fare' (payment category), custom_str4 = 'skootlink' (app tag)
 */
import { generateSignature, PAYFAST_PROCESS_URL, SITE_URL, appBaseUrl, payfastNotifyUrl } from './payfast.js';

export async function createGigCheckout(supabase, user, gig, isNative, requestHeaders = {}) {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const passphrase = process.env.PAYFAST_PASSPHRASE || '';
  if (!merchantId || !merchantKey) throw new Error('Payments are not configured');

  const amount = Number(gig.fare_amount);
  if (!(amount > 0)) throw new Error('This gig has no fare to pay');

  const m_payment_id = `gig_${gig.id}_${Date.now()}`;
  const { error: payErr } = await supabase.from('platform_payments').insert({
    user_id: user.id,
    kind: 'gig_fare',
    gig_id: gig.id,
    amount,
    m_payment_id,
  });
  if (payErr) throw payErr;

  const base = appBaseUrl(requestHeaders);
  // Native: a server-side 302 to co.za.skootlink.app://payment-result (see
  // payment-redirect.js), served from the same deploy as this function.
  // Web: back to the gig's status page. Field order below is PayFast's
  // documented order, which the form signature depends on.
  const nativeBack = (status) =>
    `${base}/.netlify/functions/payment-redirect?status=${status}&category=gig&gig_id=${gig.id}`;
  const return_url = isNative ? nativeBack('success') : `${base}/gig-status/${gig.id}?payment=success`;
  const cancel_url = isNative ? nativeBack('cancelled') : `${base}/gig-status/${gig.id}?payment=cancelled`;

  const kind = gig.gig_type === 'delivery' ? 'Delivery' : 'Ride';
  const fields = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url,
    cancel_url,
    notify_url: payfastNotifyUrl(requestHeaders),
    name_first: (user.user_metadata?.full_name || 'Skootlink').split(' ')[0],
    email_address: user.email,
    m_payment_id,
    amount: amount.toFixed(2),
    item_name: `Skootlink ${kind} #${gig.id}`.slice(0, 100),
    item_description: `${gig.pickup_address} to ${gig.dropoff_address}`.slice(0, 255),
    custom_str1: user.id,
    custom_str2: String(gig.id),
    custom_str3: 'gig_fare',
    custom_str4: 'skootlink',
  };
  const signature = generateSignature(fields, passphrase);

  console.log(`[gigCheckout] gig=${gig.id} m_payment_id=${m_payment_id} amount=${fields.amount} native=${isNative} base=${base} site=${SITE_URL}`);
  return { action_url: PAYFAST_PROCESS_URL, fields: { ...fields, signature } };
}
