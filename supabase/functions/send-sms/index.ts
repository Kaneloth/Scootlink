import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req) => {
  // Only accept POST requests
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
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build Basic Auth header
    const authHeader = 'Basic ' + btoa(`${tokenId}:${tokenSecret}`);

    const payload = {
      to: to,
      body: message,
      from: 'Skootlink', // Your sender ID – must be registered with BulkSMS
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
      console.error('BulkSMS error:', result);
      return new Response(
        JSON.stringify({ error: result.title || 'SMS sending failed' }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, messageId: result.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Edge Function error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
