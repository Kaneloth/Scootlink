// Nominatim geocoding proxy — adds the required User-Agent header that
// browsers cannot set directly, so the full OSM geocoder is available
// as a fallback when Photon and Open-Meteo are both unavailable.
// GET /.netlify/functions/geocode?q=<location>

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const q = event.queryStringParameters?.q;
  if (!q || !q.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing q parameter' }) };
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Skootlink/1.0 (vehicle-rental-app; contact via netlify)',
        'Accept-Language': 'en',
      },
    });

    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: 'Nominatim error' }) };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
