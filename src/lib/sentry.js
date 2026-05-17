/**
 * Sentry error monitoring initialisation.
 *
 * Call initSentry() once at the very top of main.jsx, before React renders.
 *
 * Required environment variable (set in Netlify → Site settings → Env vars):
 *   VITE_SENTRY_DSN  — the DSN string from your Sentry project
 *
 * If the variable is missing or empty Sentry stays disabled silently
 * (useful during local development when you don't want noise).
 */

import * as Sentry from '@sentry/react';

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return; // Disabled locally or if DSN not yet configured

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // "production" | "development"

    // Capture 100 % of errors; sample 10 % of performance traces in production
    sampleRate: 1.0,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,

    // Breadcrumbs and context
    autoSessionTracking: true,
    attachStacktrace: true,

    integrations: [
      // Tracks route changes as transactions
      Sentry.browserTracingIntegration(),
      // Records a short replay video clip around each error
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Replay: capture 0 % of normal sessions, 100 % of sessions with an error
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

/**
 * Call this after the user logs in to attach their identity to error reports.
 *   setUser({ id: profile.id, email: profile.email })
 * Call setUser(null) on logout.
 */
export function setUser(user) {
  Sentry.setUser(user);
}

/**
 * Manually capture an exception that you have already handled in a try/catch
 * but still want recorded in Sentry.
 *   captureError(err, { context: 'uploadPhoto' });
 */
export function captureError(error, extras = {}) {
  Sentry.withScope((scope) => {
    Object.entries(extras).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureException(error);
  });
}

// Re-export the ErrorBoundary component so you can wrap your app in main.jsx
export { Sentry };
