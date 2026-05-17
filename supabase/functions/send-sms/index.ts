import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * verify-licence — Driving licence verification edge function.
 *
 * Currently runs in DEMO MODE: validates the licence number format and year,
 * then returns a simulated result. Replace the body of `callTrafficDeptAPI`
 * with a real HTTP call once the traffic department / eNaTIS API credentials
 * are available.
 *
 * Expected POST body:
 *   { licenceNumber: string, licenceYear: number, idNumber?: string }
 *
 * Response:
 *   { verified: boolean, status: string, message: string, demo: boolean }
 */

// ---------------------------------------------------------------------------
// Stub: replace this function with a real API call when credentials exist.
// ---------------------------------------------------------------------------
async function callTrafficDeptAPI(
  licenceNumber: string,
  licenceYear: number,
  idNumber: string,
): Promise<{ verified: boolean; status: string; detail?: string }> {

  // TODO: Replace with actual eNaTIS / traffic-dept API call, e.g.:
  //
  // const apiKey = Deno.env.get('TRAFFIC_DEPT_API_KEY');
  // const response = await fetch('https://api.enatis.gov.za/v1/licence/verify', {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ licence_number: licenceNumber, id_number: idNumber }),
  // });
  // const data = await response.json();
  // return { verified: data.valid, status: data.status, detail: data.message };

  // ── DEMO MODE ──────────────────────────────────────────────────────────────
  // Simulate a short network delay
  await new Promise(r => setTimeout(r, 1200));

  // Basic format checks:
  // SA licence numbers are typically 8–13 alphanumeric characters
  if (licenceNumber.length < 6 || licenceNumber.length > 15) {
    return { verified: false, status: 'INVALID_FORMAT', detail: 'Licence number must be between 6 and 15 characters.' };
  }
  if (!/^[A-Z0-9]+$/.test(licenceNumber)) {
    return { verified: false, status: 'INVALID_FORMAT', detail: 'Licence number may only contain letters and numbers.' };
  }
  const currentYear = new Date().getFullYear();
  if (licenceYear < 1960 || licenceYear > currentYear) {
    return { verified: false, status: 'INVALID_YEAR', detail: `Issue year must be between 1960 and ${currentYear}.` };
  }

  // Demo: treat all otherwise-valid numbers as verified
  return { verified: true, status: 'VERIFIED', detail: 'Licence verified with traffic department (demo mode).' };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { licenceNumber, licenceYear, idNumber = '' } = await req.json();

    if (!licenceNumber || !licenceYear) {
      return new Response(
        JSON.stringify({ verified: false, message: 'Missing licenceNumber or licenceYear' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        demo:     true, // Remove this flag once a real API is integrated
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('verify-licence: unhandled error:', err);
    return new Response(
      JSON.stringify({ verified: false, message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
