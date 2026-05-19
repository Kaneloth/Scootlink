import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * verify-licence — Driving licence verification edge function.
 *
 * DEMO MODE: validates format then returns verified=true for any
 * correctly-formatted licence. Replace callTrafficDeptAPI with a real
 * HTTP call once eNaTIS / traffic-dept API credentials are available.
 *
 * Expected POST body:
 *   { licenceNumber: string, licenceYear: number, idNumber?: string }
 *
 * Response:
 *   { verified: boolean, status: string, message: string, demo: boolean }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------------
// Demo stub — replace with a real API call when credentials exist.
// ---------------------------------------------------------------------------
async function callTrafficDeptAPI(
  licenceNumber: string,
  licenceYear: number,
  _idNumber: string,
): Promise<{ verified: boolean; status: string; detail?: string }> {
  // Simulate a short network delay
  await new Promise(r => setTimeout(r, 800));

  // All correctly-formatted licences pass in demo mode.
  // (No format rejection — let anyone through so the UI flow can be tested.)
  const currentYear = new Date().getFullYear();
  if (licenceYear < 1960 || licenceYear > currentYear) {
    return {
      verified: false,
      status: 'INVALID_YEAR',
      detail: `Issue year must be between 1960 and ${currentYear}.`,
    };
  }

  return {
    verified: true,
    status: 'VERIFIED',
    detail: 'Licence verified (demo mode).',
  };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  try {
    const { licenceNumber, licenceYear, idNumber = '' } = await req.json();

    if (!licenceNumber || !licenceYear) {
      return new Response(
        JSON.stringify({ verified: false, message: 'Missing licenceNumber or licenceYear' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const result = await callTrafficDeptAPI(
      String(licenceNumber).toUpperCase().replace(/\s/g, ''),
      Number(licenceYear),
      String(idNumber),
    );

    console.log(`verify-licence: ${licenceNumber} → ${result.status}`);

    return new Response(
      JSON.stringify({
        verified: result.verified,
        status:   result.status,
        message:  result.detail ?? (result.verified ? 'Licence verified successfully' : 'Verification failed'),
        demo:     true,
      }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('verify-licence: unhandled error:', err);
    return new Response(
      JSON.stringify({ verified: false, message: 'Internal server error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
