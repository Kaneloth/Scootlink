import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPPORT_EMAIL   = 'support@skootlink.co.za';
const FROM_ADDRESS    = 'noreply@skootlink.co.za'; // must be a verified domain in Resend

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CATEGORY_LABELS: Record<string, string> = {
  bug:     'Bug Report',
  payment: 'Payment Issue',
  rental:  'Rental Problem',
  account: 'Account Support',
};

serve(async (req) => {
  // Handle CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { from_name, from_email, subject, category, message, user_id } =
      await req.json();

    if (!subject || !category || !message || !from_email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const categoryLabel = CATEGORY_LABELS[category] ?? category;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 620px; color: #1a1a1a;">
        <div style="background: #0f172a; padding: 20px 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 20px; color: #ffffff;">
            Skootlink — New Support Request
          </h1>
        </div>
        <div style="border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr style="background: #f8fafc;">
              <td style="padding: 10px 14px; font-weight: 600; width: 120px; border: 1px solid #e2e8f0;">From</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${from_name} &lt;${from_email}&gt;</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; font-weight: 600; border: 1px solid #e2e8f0; background: #f8fafc;">Category</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${categoryLabel}</td>
            </tr>
            <tr style="background: #f8fafc;">
              <td style="padding: 10px 14px; font-weight: 600; border: 1px solid #e2e8f0;">Subject</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${subject}</td>
            </tr>
            ${user_id ? `
            <tr>
              <td style="padding: 10px 14px; font-weight: 600; border: 1px solid #e2e8f0; background: #f8fafc;">User ID</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 13px;">${user_id}</td>
            </tr>` : ''}
          </table>

          <h3 style="margin: 0 0 10px; font-size: 16px;">Message</h3>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; white-space: pre-wrap; line-height: 1.6;">
${message}
          </div>

          <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">
            Sent via the Skootlink in-app support form. Reply directly to this email to respond to the user.
          </p>
        </div>
      </div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     `Skootlink Support <${FROM_ADDRESS}>`,
        to:       [SUPPORT_EMAIL],
        reply_to: from_email,
        subject:  `[${categoryLabel}] ${subject}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error(`Resend API error: ${errText}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[send-contact-email]', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
