/**
 * Geocode a free-form location string into { latitude, longitude, displayName }.
 *
 * Uses Photon (photon.komoot.io) — a free, open geocoder built on OpenStreetMap data.
 * Unlike Nominatim, Photon works from browser fetch() without a User-Agent header
 * (browsers block that header for security and Nominatim silently rejects requests
 * that lack it, causing every city lookup to return null).
 *
 * Returns null on failure or empty results.
 */
export async function geocodeLocation(query) {
  if (!query || query.trim().length === 0) return null;

  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      console.error('Geocoding HTTP error', res.status, res.statusText);
      return null;
    }

    const geojson = await res.json();
    const feature = geojson?.features?.[0];
    if (!feature) {
      console.warn('[geocode] Photon returned no results for:', query);
      return null;
    }

    // GeoJSON coordinates are [longitude, latitude] — note the order
    const [longitude, latitude] = feature.geometry.coordinates;
    const p = feature.properties;
    const result = {
      latitude,
      longitude,
      displayName: [p.name, p.city, p.state, p.country].filter(Boolean).join(', '),
    };
    console.log('[geocode] Resolved:', query, '→', result);
    return result;
  } catch (err) {
    console.error('Geocoding network error', err);
  }

  return null;
}
