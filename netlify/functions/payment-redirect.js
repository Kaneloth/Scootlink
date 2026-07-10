/**
 * Netlify Function: payment-redirect
 *
 * A pure HTTP 302 redirect straight to co.za.skootlink.app://payment-result.
 * This exists specifically because a client-side JS redirect (the previous
 * approach, via public/payment-callback.html) is silently blocked by Chrome
 * on Android when it isn't tied to a genuine user tap — which a PayFast
 * return_url redirect never is. A real server-side redirect doesn't have
 * this problem: it's the exact same mechanism the Google sign-in flow
 * already uses successfully (Supabase redirects straight to the custom
 * scheme with no intermediate page), which is why that flow never had this
 * issue in the first place.
 *
 * Only used for native app return_url/cancel_url — web users go straight to
 * a normal https:// page, no redirect function involved.
 */
export const handler = async (event) => {
  const params = event.queryStringParameters || {};
  const qs = new URLSearchParams(params).toString();

  return {
    statusCode: 302,
    headers: {
      Location: `co.za.skootlink.app://payment-result?${qs}`,
    },
    body: '',
  };
};
