import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Normalise a South African phone number to E.164 international format.
 * Handles: +27XXXXXXXXX, 27XXXXXXXXX, 0XXXXXXXXX (10-digit local), plain 9-digit
 */
function normaliseSAPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (raw.startsWith('+') && digits.length >= 10) return raw; // already E.164
  if (digits.startsWith('27') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+27' + digits.slice(1);
  if (digits.length === 9) return '+27' + digits;

  return raw; // unknown format — pass through and let BulkSMS reject it
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { to, message } = await req.json();

    if (!to || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing "to" or "message" in request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tokenId = Deno.env.get('BULKSMS_TOKEN_ID');
    const tokenSecret = Deno.env.get('BULKSMS_TOKEN_SECRET');

    if (!tokenId || !tokenSecret) {
      console.error('send-sms: BULKSMS_TOKEN_ID or BULKSMS_TOKEN_SECRET not set');
      return new Response(
        JSON.stringify({ error: 'Server configuration error: BulkSMS credentials missing' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const normalisedTo = normaliseSAPhone(String(to));
    console.log(`send-sms: sending to ${normalisedTo} (original: ${to})`);

    const authHeader = 'Basic ' + btoa(`${tokenId}:${tokenSecret}`);

    const payload = {
      to: normalisedTo,
      body: message,
    };

    const response = await fetch('https://api.bulksms.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('send-sms: BulkSMS API error:', JSON.stringify(result));
      return new Response(
        JSON.stringify({ error: result.title || result.detail || 'SMS sending failed', detail: result }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // BulkSMS v1 returns an array when sending to a single recipient too
    const msgId = Array.isArray(result) ? result[0]?.id : result.id;
    console.log('send-sms: delivered, id =', msgId);
    return new Response(
      JSON.stringify({ success: true, messageId: msgId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('send-sms: unhandled error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
