/**
 * Netlify Function: trigger-expiry-check
 * 
 * A DEV-ONLY endpoint that manually runs the vehicle-expiry-check logic
 * so you can test the full flow without waiting for the daily cron.
 *
 * Usage:
 *   GET /.netlify/functions/trigger-expiry-check?secret=YOUR_TEST_SECRET
 *
 * Set EXPIRY_TEST_SECRET in your Netlify environment variables.
 * DELETE THIS FILE before going to production, or keep it but ensure
 * the secret is strong and not shared.
 *
 * Place at: netlify/functions/trigger-expiry-check.js
 */

// Import the handler from the real scheduled function
import { handler as expiryHandler } from './vehicle-expiry-check.js';

export const handler = async (event) => {
  // Guard with a secret so random people can't trigger it
  const secret = event.queryStringParameters?.secret;
  const expectedSecret = process.env.EXPIRY_TEST_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized — provide ?secret=YOUR_TEST_SECRET' }),
    };
  }

  console.log('[trigger-expiry-check] Manually triggered at', new Date().toISOString());

  // Run the real expiry handler
  const result = await expiryHandler({});

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      triggered_at: new Date().toISOString(),
      result: JSON.parse(result.body),
    }),
  };
};
