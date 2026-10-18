// src/lib/payfastCheckout.js
//
// Send the user to PayFast with a signed form from one of our functions
// ({ action_url, fields }).
//   Web:    POST the form (the page navigates to PayFast; return_url brings
//           the user back).
//   Native: open PayFast in a Custom Tab with the same fields as a query
//           string. return_url is the payment-redirect function, which sends
//           co.za.skootlink.app://payment-result back into the app; App.jsx
//           closes the tab and fires 'skootlink:payment-result'.
// Same mechanism as the existing credits / verification payments.

import { Capacitor } from '@capacitor/core';

export const PAYMENT_RESULT_EVENT = 'skootlink:payment-result';

export async function openPayfastCheckout({ action_url, fields }) {
  if (Capacitor.isNativePlatform()) {
    const qs = new URLSearchParams(fields).toString();
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: `${action_url}?${qs}`, presentationStyle: 'popover' });
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action_url;
  Object.entries(fields).forEach(([k, v]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}
