const BREVO_API_KEY = process.env.BREVO_API_KEY;

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { name, email, message } = body;
  if (!name || !email || !message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Name, email, and message are required' }),
    };
  }

  // Build the email content
  const subject = `New Skootlink Contact: ${name}`;
  const html = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Message:</strong></p>
    <p>${message}</p>
  `;

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Skootlink Website', email: 'noreply@skootlink.co.za' },
        to: [{ email: 'help@skootlink.co.za', name: 'Skootlink Support' }],
        replyTo: { email, name },
        subject,
        htmlContent: html,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Brevo error:', data);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to send email. Please try again later.' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Contact form error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error. Please try again later.' }),
    };
  }
};