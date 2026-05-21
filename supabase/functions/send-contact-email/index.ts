import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const FROM_EMAIL = 'noreply@skootlink.co.za';
const FROM_NAME  = 'Skootlink';

// ── HTML email builder ────────────────────────────────────────────────────────

function buildHtml(recipientName: string, vehicleInfo: string, contractText: string): string {
  // Turn each line of the contract into styled HTML
  const contractHtml = contractText
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<br>';
      // All-caps short lines are section headings
      if (trimmed === trimmed.toUpperCase() && trimmed.length < 60) {
        return `<h3 style="margin:20px 0 4px;font-size:12px;letter-spacing:.08em;color:#0f74d1;text-transform:uppercase">${trimmed}</h3>`;
      }
      return `<p style="margin:0 0 6px;color:#333;font-size:13px;line-height:1.6">${line}</p>`;
    })
    .join('');

  const year = new Date().getFullYear();
  const dateStr = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10)">

      <!-- Header -->
      <tr><td style="background:#0f74d1;padding:24px 32px">
        <span style="color:#fff;font-size:22px;font-weight:bold;letter-spacing:-.5px">Skootlink</span>
        <span style="color:#b3d9ff;font-size:13px;margin-left:12px">Vehicle Rental Platform</span>
      </td></tr>

      <!-- Intro -->
      <tr><td style="padding:28px 32px 0">
        <h2 style="margin:0 0 12px;color:#111;font-size:18px">Rental Agreement — Signed ✅</h2>
        <p style="margin:0 0 10px;color:#444;font-size:14px;line-height:1.6">Hi <strong>${recipientName}</strong>,</p>
        <p style="margin:0 0 10px;color:#444;font-size:14px;line-height:1.6">
          Your Skootlink rental agreement has been <strong>signed by both parties</strong> and is now active.
          ${vehicleInfo ? `The vehicle is <strong>${vehicleInfo}</strong>.` : ''}
        </p>
        <p style="margin:0 0 20px;color:#444;font-size:14px;line-height:1.6">
          A full copy of your signed agreement is below for your records.
        </p>
      </td></tr>

      <!-- Agreement box -->
      <tr><td style="padding:0 32px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
          <p style="margin:0 0 16px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">Signed Agreement — ${dateStr}</p>
          ${contractHtml}
        </div>
      </td></tr>

      <!-- Support footer -->
      <tr><td style="padding:24px 32px">
        <p style="margin:0 0 6px;color:#444;font-size:13px;line-height:1.6">
          Need help? Email us at <a href="mailto:help@skootlink.co.za" style="color:#0f74d1;text-decoration:none">help@skootlink.co.za</a>.
        </p>
        <p style="margin:0;color:#888;font-size:12px">— The Skootlink Team</p>
      </td></tr>

      <!-- Bottom bar -->
      <tr><td style="background:#f9fafb;border-top:1px solid #eef0f3;padding:14px 32px;text-align:center">
        <p style="margin:0;color:#bbb;font-size:11px">© ${year} Skootlink · noreply@skootlink.co.za</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Brevo send ────────────────────────────────────────────────────────────────

async function sendEmail(toEmail: string, toName: string, subject: string, html: string) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender:      { email: FROM_EMAIL, name: FROM_NAME },
      to:          [{ email: toEmail, name: toName }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo ${res.status}: ${body}`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY secret is not set in Supabase Edge Function Secrets.');
    }

    const { contractText, ownerEmail, ownerName, driverEmail, driverName, vehicleInfo } =
      await req.json();

    if (!contractText) throw new Error('contractText is required');
    if (!driverEmail)  throw new Error('driverEmail is required');

    const subject = vehicleInfo
      ? `Your Skootlink Rental Agreement — ${vehicleInfo}`
      : 'Your Skootlink Rental Agreement';

    const jobs: Promise<void>[] = [
      sendEmail(
        driverEmail,
        driverName || 'Driver',
        subject,
        buildHtml(driverName || 'Driver', vehicleInfo || '', contractText),
      ),
    ];

    if (ownerEmail) {
      jobs.push(
        sendEmail(
          ownerEmail,
          ownerName || 'Owner',
          subject,
          buildHtml(ownerName || 'Owner', vehicleInfo || '', contractText),
        ),
      );
    }

    await Promise.all(jobs);

    return new Response(
      JSON.stringify({ success: true, ownerEmailed: !!ownerEmail }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('send-contract-email error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
