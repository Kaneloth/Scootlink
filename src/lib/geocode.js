// src/lib/geocode.js
const cache = new Map(); // Simple in-memory cache
let lastCallTime = 0;

export async function geocodeLocation(query) {
  if (!query || query.trim().length === 0) return null;

  const key = query.trim().toLowerCase();
  
  // Return cached result if we have it
  if (cache.has(key)) {
    return cache.get(key);
  }

  // Rate limiter: wait if needed to respect 1 req/sec
  const now = Date.now();
  const timeSinceLastCall = now - lastCallTime;
  if (timeSinceLastCall < 1100) {
    await new Promise(resolve => setTimeout(resolve, 1100 - timeSinceLastCall));
  }
  lastCallTime = Date.now();

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Skootlink/1.0 (support@skootlink.com)',
        'Accept-Language': 'en',
      },
    });

    if (!res.ok) {
      console.error('Geocoding HTTP error', res.status);
      // If rate-limited, don't cache the failure
      if (res.status === 429 || res.status === 503) return null;
      return null;
    }

    const data = await res.json();
    if (data && data.length > 0) {
      const result = {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
      // Cache the successful result
      cache.set(key, result);
      return result;
    }
  } catch (err) {
    console.error('Geocoding network error', err);
  }
  return null;
}