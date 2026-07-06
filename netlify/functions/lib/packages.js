/**
 * packages — single source of truth for Skootlink credit pack pricing
 * Place at: netlify/functions/lib/packages.js
 *
 * Keep in sync with the PACKAGES constants in Credits.jsx, CreditBalance.jsx,
 * and Settings.jsx — a mismatch here means PayFast charges/grants a
 * completely different amount than what the UI advertises.
 */
export const PACKAGES = {
  starter:  { credits: 240,  price_zar: 49,  label: 'Starter Pack'  },
  standard: { credits: 400,  price_zar: 79,  label: 'Standard Pack' },
  pro:      { credits: 660,  price_zar: 129, label: 'Pro Pack'      },
  business: { credits: 1040, price_zar: 199, label: 'Business Pack'  },
};
