import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Required by every Supabase edge function called from a browser.
// The OPTIONS preflight MUST return these headers or Chrome/Safari block the request.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Normalise a South African phone number to E.164 international format.
 * Handles: +27XXXXXXXXX, 27XXXXXXXXX, 0XXXXXXXXX (10-digit local), plain 9-digit
 */
function normaliseSAPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (raw.startsWith('+') && digits.length >= 10) return raw;
  if (digits.startsWith('27') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+27' + digits.slice(1);
  if (digits.length === 9) return '+27' + digits;

  return raw;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

Deno.serve(async (req) => {
  // ── Preflight (browser sends OPTIONS before every cross-origin POST) ─────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { to, message } = await req.json();

    if (!to || !message) {
      return json({ error: 'Missing "to" or "message" in request body' }, 400);
    }

    const tokenId     = Deno.env.get('BULKSMS_TOKEN_ID');
    const tokenSecret = Deno.env.get('BULKSMS_TOKEN_SECRET');

    if (!tokenId || !tokenSecret) {
      console.error('send-sms: BULKSMS_TOKEN_ID or BULKSMS_TOKEN_SECRET not set');
      return json({ error: 'Server configuration error: BulkSMS credentials missing' }, 500);
    }

    const normalisedTo = normaliseSAPhone(String(to));
    console.log(`send-sms: sending to ${normalisedTo} (original: ${to})`);

    const response = await fetch('https://api.bulksms.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${tokenId}:${tokenSecret}`),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: normalisedTo, body: message }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('send-sms: BulkSMS API error:', JSON.stringify(result));
      return json({ error: result.title || result.detail || 'SMS sending failed', detail: result }, response.status);
    }

    const msgId = Array.isArray(result) ? result[0]?.id : result.id;
    console.log('send-sms: delivered, id =', msgId);
    return json({ success: true, messageId: msgId });

  } catch (err) {
    console.error('send-sms: unhandled error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});
