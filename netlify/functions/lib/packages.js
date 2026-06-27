/**
 * packages — single source of truth for Skootlink credit pack pricing
 * Place at: netlify/functions/lib/packages.js
 */
export const PACKAGES = {
  starter:  { credits: 15,  price_zar: 39,  label: 'Starter Pack'  },
  standard: { credits: 30,  price_zar: 59,  label: 'Standard Pack' },
  pro:      { credits: 60,  price_zar: 99,  label: 'Pro Pack'      },
  business: { credits: 200, price_zar: 199, label: 'Business Pack'  },
};
