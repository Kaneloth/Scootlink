const BREVO_API_KEY = process.env.BREVO_API_KEY ?? '';
const FROM_EMAIL = 'noreply@skootlink.co.za';
const FROM_NAME  = 'Skootlink';

function buildHtml(recipientName, vehicleInfo, contractText) {
  const contractHtml = contractText
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '<br>';
      if (trimmed === trimmed.toUpperCase() && trimmed.length < 60) {
        return `<h3 style="margin:20px 0 4px;font-size:12px;letter-spacing:.08em;color:#0f74d1;text-transform:uppercase">${trimmed}</h3>`;
      }
      return `<p style="margin:0 0 6px;color:#333;font-size:13px;line-height:1.6">${line}</p>`;
    })
    .join('');

  const year   = new Date().getFullYear();
  const dateStr = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10)">
      <tr><td style="background:#0f74d1;padding:24px 32px">
        <span style="color:#fff;font-size:22px;font-weight:bold;letter-spacing:-.5px">Skootlink</span>
        <span style="color:#b3d9ff;font-size:13px;margin-left:12px">Vehicle Rental Platform</span>
      </td></tr>
      <tr><td style="padding:28px 32px 0">
        <h2 style="margin:0 0 12px;color:#111;font-size:18px">Rental Agreement — Signed ✅</h2>
        <p style="margin:0 0 10px;color:#444;font-size:14px;line-height:1.6">Hi <strong>${recipientName}</strong>,</p>
        <p style="margin:0 0 10px;color:#444;font-size:14px;line-height:1.6">
          Your Skootlink rental agreement has been <strong>signed by both parties</strong> and is now active.
          ${vehicleInfo ? `The vehicle is <strong>${vehicleInfo}</strong>.` : ''}
        </p>
        <p style="margin:0 0 20px;color:#444;font-size:14px;line-height:1.6">
          Your signed agreement is below for your records.
        </p>
      </td></tr>
      <tr><td style="padding:0 32px">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
          <p style="margin:0 0 16px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">Signed Agreement — ${dateStr}</p>
          ${contractHtml}
        </div>
      </td></tr>
      <tr><td style="padding:24px 32px">
        <p style="margin:0 0 6px;color:#444;font-size:13px;line-height:1.6">
          Questions? Email us at <a href="mailto:help@skootlink.co.za" style="color:#0f74d1;text-decoration:none">help@skootlink.co.za</a>.
        </p>
        <p style="margin:0;color:#888;font-size:12px">— The Skootlink Team</p>
      </td></tr>
      <tr><td style="background:#f9fafb;border-top:1px solid #eef0f3;padding:14px 32px;text-align:center">
        <p style="margin:0;color:#bbb;font-size:11px">© ${year} Skootlink · noreply@skootlink.co.za</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function sendBrevoEmail(toEmail, toName, subject, html) {
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
    const text = await res.text();
    throw new Error(`Brevo ${res.status}: ${text}`);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    if (!BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY is not set in Netlify environment variables.');
    }

    const { contractText, ownerEmail, ownerName, driverEmail, driverName, vehicleInfo } =
      JSON.parse(event.body || '{}');

    if (!contractText) throw new Error('contractText is required');
    if (!driverEmail)  throw new Error('driverEmail is required');

    const subject = vehicleInfo
      ? `Your Skootlink Rental Agreement — ${vehicleInfo}`
      : 'Your Skootlink Rental Agreement';

    const jobs = [
      sendBrevoEmail(
        driverEmail,
        driverName || 'Driver',
        subject,
        buildHtml(driverName || 'Driver', vehicleInfo || '', contractText),
      ),
    ];

    if (ownerEmail) {
      jobs.push(
        sendBrevoEmail(
          ownerEmail,
          ownerName || 'Owner',
          subject,
          buildHtml(ownerName || 'Owner', vehicleInfo || '', contractText),
        ),
      );
    }

    await Promise.all(jobs);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ownerEmailed: !!ownerEmail }),
    };
  } catch (err) {
    console.error('send-contract-email error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
