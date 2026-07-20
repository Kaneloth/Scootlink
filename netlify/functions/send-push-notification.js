/**
 * Netlify Function: send-push-notification
 * Triggered by Supabase Database Webhooks on INSERT into two tables:
 *   - notifications (contracts, rentals, proximity alerts — everything
 *     already going through the in-app bell)
 *   - messages (new chat messages — deliberately never touches the bell/
 *     notifications table, so this needs its own separate trigger)
 *
 * Calls FCM's HTTP v1 API directly rather than using the firebase-admin
 * SDK. firebase-admin (via its internal google-auth-library dependency)
 * repeatedly hit a Netlify esbuild bundling bug — "Class extends value
 * #<Object> is not a constructor" — that survived multiple fix attempts
 * (namespace imports, createRequire, the modular API, external_node_modules).
 * Going direct avoids the entire fragile dependency chain: only Node's
 * built-in crypto module (for signing the OAuth JWT) and native fetch are
 * used, neither of which can be mis-bundled the way a third-party package
 * with native/polyfill internals can.
 *
 * Set up in Supabase: Database → Webhooks → Create two webhooks, one per
 * table, both POSTing to this function's URL, both INSERT-only. Add a
 * custom header X-Webhook-Secret matching SUPABASE_WEBHOOK_SECRET below.
 * (Or, if using the SQL-trigger fallback instead of the dashboard UI, the
 * secret lives in that trigger function's body — see db_webhooks_fallback.sql.)
 */
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Exchanges the service account's private key for a short-lived OAuth2
// access token, following Google's standard server-to-server JWT-bearer
// flow — https://developers.google.com/identity/protocols/oauth2/service-account
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claims}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('OAuth token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function sendFcmMessage(accessToken, projectId, token, title, body, data) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        android: { priority: 'high' },
      },
    }),
  });
  const result = await res.json();
  if (!res.ok) {
    const err = new Error(result.error?.message || 'FCM send failed');
    err.code = result.error?.status || 'unknown';
    err.fcmError = result.error;
    throw err;
  }
  return result;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const webhookSecret = event.headers['x-webhook-secret'];
  if (webhookSecret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { table, record } = payload;
  if (!record) return { statusCode: 400, body: JSON.stringify({ error: 'Missing record' }) };

  let recipientId, title, body, data = {};

  if (table === 'notifications') {
    recipientId = record.user_id;
    title = record.title;
    body = record.body;
    data = { type: record.type || '', notification_id: String(record.id) };
  } else if (table === 'messages') {
    recipientId = record.receiver_id;
    body = record.body;
    const { data: sender } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', record.sender_id)
      .single();
    title = `New message from ${sender?.full_name?.split(' ')[0] || 'someone'}`;
    data = { type: 'message', sender_id: record.sender_id };
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown table: ' + table }) };
  }

  if (!recipientId) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, reason: 'no recipient' }) };
  }

  const { data: tokens, error: tokenErr } = await supabaseAdmin
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', recipientId);
  if (tokenErr || !tokens?.length) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, reason: 'no devices' }) };
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Invalid FIREBASE_SERVICE_ACCOUNT_KEY: ' + e.message }) };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(serviceAccount);
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }

  const results = await Promise.allSettled(
    tokens.map(t => sendFcmMessage(accessToken, serviceAccount.project_id, t.token, title, body, data))
  );

  const invalidTokens = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected' && (
      r.reason?.code === 'UNREGISTERED' ||
      r.reason?.code === 'INVALID_ARGUMENT'
    )) {
      invalidTokens.push(tokens[i].token);
    }
  });
  if (invalidTokens.length) {
    await supabaseAdmin.from('device_push_tokens').delete().in('token', invalidTokens);
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  const failureReasons = results
    .filter(r => r.status === 'rejected')
    .map(r => ({ code: r.reason?.code, message: r.reason?.message }));
  if (failed > 0) {
    console.warn('[send-push-notification] Some sends failed:', failureReasons);
  }

  return { statusCode: 200, body: JSON.stringify({ sent, failed, failureReasons }) };
};