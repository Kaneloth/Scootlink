/**
 * Netlify Function: send-push-notification
 * Triggered by Supabase Database Webhooks on INSERT into two tables:
 *   - notifications (contracts, rentals, proximity alerts — everything
 *     already going through the in-app bell)
 *   - messages (new chat messages — deliberately never touches the bell/
 *     notifications table, so this needs its own separate trigger)
 *
 * Set up in Supabase: Database → Webhooks → Create two webhooks, one per
 * table, both POSTing to this function's URL, both INSERT-only. Add a
 * custom header X-Webhook-Secret matching SUPABASE_WEBHOOK_SECRET below,
 * so this endpoint can't be triggered by anyone who just finds the URL.
 */
import * as admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

// Netlify function containers can be reused across invocations — avoid
// re-initializing the Firebase app (and its internal auth token cache)
// on every single call.
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify this genuinely came from Supabase's webhook, not a public POST
  // from anyone who discovers this function's URL.
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

  // A user may have more than one device registered
  const { data: tokens, error: tokenErr } = await supabaseAdmin
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', recipientId);
  if (tokenErr || !tokens?.length) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, reason: 'no devices' }) };
  }

  const results = await Promise.allSettled(
    tokens.map(t => admin.messaging().send({
      token: t.token,
      notification: { title, body },
      data,
      android: { priority: 'high' },
    }))
  );

  // Clean up tokens FCM reports as no longer valid (app uninstalled, token
  // expired, etc.) — otherwise this table only ever grows and every future
  // send wastes calls on dead devices.
  const invalidTokens = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected' && (
      r.reason?.code === 'messaging/registration-token-not-registered' ||
      r.reason?.code === 'messaging/invalid-registration-token'
    )) {
      invalidTokens.push(tokens[i].token);
    }
  });
  if (invalidTokens.length) {
    await supabaseAdmin.from('device_push_tokens').delete().in('token', invalidTokens);
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  if (failed > 0) {
    console.warn('[send-push-notification] Some sends failed:', results.filter(r => r.status === 'rejected').map(r => r.reason?.message));
  }

  return { statusCode: 200, body: JSON.stringify({ sent, failed }) };
};