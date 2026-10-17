import { Capacitor } from '@capacitor/core';

// Netlify function URL builder.
//
// Web (production and Deploy Previews): relative path, so a preview calls
// its own functions and never production's.
// Native Android: the WebView serves the bundled app from https://localhost,
// so a relative path would point at the phone itself. Native always calls
// the production site.
const PROD_ORIGIN = 'https://skootlink.co.za';

export const fnUrl = (name) =>
  `${Capacitor.isNativePlatform() ? PROD_ORIGIN : ''}/.netlify/functions/${name}`;
