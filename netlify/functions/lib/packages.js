/**
 * packages — single source of truth for Skootlink credit pack pricing
 * Place at: netlify/functions/lib/packages.js
 */
export const PACKAGES = {
  starter:  { credits: 10,  price_zar: 29,  label: 'Starter Pack'  },
  standard: { credits: 30,  price_zar: 49,  label: 'Standard Pack' },
  pro:      { credits: 60,  price_zar: 79,  label: 'Pro Pack'      },
  business: { credits: 200, price_zar: 199, label: 'Business Pack'  },
};
