const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { licenceNumber, yearIssued } = body;
  if (!licenceNumber || !yearIssued) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'licenceNumber and yearIssued are required' }) };
  }

  // ── Format validation ─────────────────────────────────────────────────────
  const clean = licenceNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(clean)) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message: 'Licence number format is invalid.' }),
    };
  }

  const year = parseInt(yearIssued);
  const currentYear = new Date().getFullYear();
  if (isNaN(year) || year < 1960 || year > currentYear) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ verified: false, message: 'Issue year is invalid.' }),
    };
  }

  // ── Save to profiles ──────────────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ license_number: clean, license_year: year })
    .eq('id', user.id);

  if (updateErr) {
    console.error('[verify-licence] profiles update error:', updateErr);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Failed to save licence details.' }),
    };
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ verified: true }),
  };
};
