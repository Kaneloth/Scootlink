// src/lib/playBilling.js
//
// The listing fee in the Android app, paid with Google Play Billing
// (migration 022). Google Play requires its own billing for this purchase in
// the app; the web keeps PayFast (listing-checkout).
//
//   1. play-listing 'start' -> a reference tied to the vehicle
//   2. Google Play purchase sheet (consumable product, reference passed as
//      appAccountToken so the server can tell which vehicle it is for)
//   3. play-listing 'verify' -> the server checks the purchase with Google,
//      activates/extends the listing, and consumes the purchase
// A purchase the app couldn't finish (app closed, no signal, a pending
// payment that completed later) is sent again by finishUnfinishedPurchases().
//
// The plugin is loaded only in the Android app, so the web bundle doesn't
// carry it.

import { Capacitor } from '@capacitor/core';
import { supabase } from '@/api/supabaseData';
import { fnUrl } from '@/lib/functionsUrl';

export const LISTING_PRODUCT_ID = 'listing_period';

export const playBillingAvailable = () => Capacitor.getPlatform() === 'android';

let pluginPromise = null;
const plugin = () => {
  pluginPromise ||= import('@capgo/native-purchases');
  return pluginPromise;
};

async function callPlayListing(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(fnUrl('play-listing'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** The listing product as Google Play shows it to this user (local price), or null. */
export async function getListingProduct() {
  try {
    const { NativePurchases, PURCHASE_TYPE } = await plugin();
    const { isBillingSupported } = await NativePurchases.isBillingSupported();
    if (!isBillingSupported) return null;
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: [LISTING_PRODUCT_ID], productType: PURCHASE_TYPE.INAPP,
    });
    return (products || []).find((p) => p.identifier === LISTING_PRODUCT_ID) || null;
  } catch (err) {
    console.error('[playBilling] product lookup failed:', err);
    return null;
  }
}

const verify = (purchaseToken) => callPlayListing({ action: 'verify', purchase_token: purchaseToken, product_id: LISTING_PRODUCT_ID });

/**
 * Buy one listing period for a vehicle.
 * Resolves { status: 'activated' | 'already_done' | 'pending' | 'refund_due' | 'cancelled' }.
 */
export async function buyListingPeriod(vehicleId) {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const { ref, product_id: productId } = await callPlayListing({ action: 'start', vehicle_id: Number(vehicleId) });

  let transaction;
  try {
    transaction = await NativePurchases.purchaseProduct({
      productIdentifier: productId || LISTING_PRODUCT_ID,
      productType: PURCHASE_TYPE.INAPP,
      appAccountToken: ref,
      isConsumable: true,
      autoAcknowledgePurchases: false, // the server consumes it once the listing is recorded
    });
  } catch (err) {
    const code = err?.code || '';
    const msg = String(err?.message || err);
    if (code === 'USER_CANCELED') return { status: 'cancelled' };
    if (/pending/i.test(msg)) return { status: 'pending' };
    if (code === 'ITEM_ALREADY_OWNED') {
      // an earlier purchase was never finished: finish it now
      const done = await finishUnfinishedPurchases();
      if (done.length) return done[done.length - 1];
    }
    throw new Error(code === 'BILLING_UNAVAILABLE'
      ? 'Google Play billing isn\'t available on this device. Check that you are signed in to the Play Store.'
      : `Google Play: ${msg}`);
  }

  const token = transaction?.purchaseToken || transaction?.transactionId;
  if (!token) throw new Error('Google Play did not return the purchase. If you were charged, open this page again.');
  return verify(token);
}

/**
 * Send any paid-but-unfinished listing purchases to the server again.
 * Returns the server's answers (empty when there was nothing to finish).
 */
export async function finishUnfinishedPurchases() {
  if (!playBillingAvailable()) return [];
  let transactions = [];
  try {
    const { NativePurchases } = await plugin();
    ({ transactions = [] } = await NativePurchases.getUnfinishedTransactions());
  } catch (err) {
    console.error('[playBilling] unfinished purchases lookup failed:', err);
    return [];
  }
  const out = [];
  for (const t of transactions) {
    if (t.productIdentifier !== LISTING_PRODUCT_ID) continue;
    const token = t.purchaseToken || t.transactionId;
    if (!token) continue;
    try {
      out.push(await verify(token));
    } catch (err) {
      console.error('[playBilling] finishing a purchase failed:', err);
    }
  }
  return out;
}
