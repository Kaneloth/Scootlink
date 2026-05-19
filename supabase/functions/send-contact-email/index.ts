import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * send-contact-email — Brevo (Sendinblue) version.
 * Expects JSON body: { from_name, from_email, subject, category, message }
 * Sends a transactional email to support@skootlink.co.za via Brevo SMTP API.
 *
 * Required secrets:
 *   BREVO_SMTP_USER  – your Brevo login email
 *   BREVO_SMTP_KEY   – the SMTP key generated in Brevo
 */

const SUPPORT_EMAIL = 'support@skootlink.co.za';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CATEGORY_LABELS: Record<string, string> = {
  bug:     'Bug Report',
  payment: 'Payment Issue',
  rental:  'Rental Problem',
  account: 'Account Support',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { from_name, from_email, subject, category, message, user_id } = await req.json();

    const missing: string[] = [];
    if (!from_email) missing.push('from_email');
    if (!subject)    missing.push('subject');
    if (!category)   missing.push('category');
    if (!message)    missing.push('message');
    if (missing.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields', missing }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const smtpUser = Deno.env.get('BREVO_SMTP_USER') || '';
    const smtpKey  = Deno.env.get('BREVO_SMTP_KEY')  || '';
    if (!smtpUser || !smtpKey) {
      throw new Error('SMTP credentials not configured');
    }

    const categoryLabel = CATEGORY_LABELS[category] ?? category;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:620px;color:#1a1a1a;">
  <div style="background:#0f172a;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;font-size:20px;color:#fff;">Skootlink — New Support Request</h1>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr style="background:#f8fafc;">
        <td style="padding:10px 14px;font-weight:600;width:120px;border:1px solid #e2e8f0;">From</td>
        <td style="padding:10px 14px;border:1px solid #e2e8f0;">${from_name || 'Unknown'} &lt;${from_email}&gt;</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:600;border:1px solid #e2e8f0;background:#f8fafc;">Category</td>
        <td style="padding:10px 14px;border:1px solid #e2e8f0;">${categoryLabel}</td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 14px;font-weight:600;border:1px solid #e2e8f0;">Subject</td>
        <td style="padding:10px 14px;border:1px solid #e2e8f0;">${subject}</td>
      </tr>
      ${user_id ? `
      <tr>
        <td style="padding:10px 14px;font-weight:600;border:1px solid #e2e8f0;background:#f8fafc;">User ID</td>
        <td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;font-size:13px;">${user_id}</td>
      </tr>` : ''}
    </table>

    <h3 style="margin:0 0 10px;font-size:16px;">Message</h3>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;white-space:pre-wrap;line-height:1.6;">${message}</div>

    <p style="margin-top:24px;font-size:12px;color:#94a3b8;">Sent via the Skootlink in-app support form. Reply directly to this email to respond to the user.</p>
  </div>
</body>
</html>`;

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key':        smtpKey,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({
        sender:      { name: 'Skootlink Support', email: `noreply@skootlink.co.za` },
        to:          [{ email: SUPPORT_EMAIL }],
        replyTo:     { email: from_email },
        subject:     `[${categoryLabel}] ${subject}`,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Brevo API error:', errText);
      throw new Error(`Brevo API error: ${errText}`);
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