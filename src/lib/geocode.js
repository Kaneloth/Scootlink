/**
 * Geocode a free-form location string into { latitude, longitude, displayName }.
 *
 * Three independent services are tried in order — the next is only called if
 * the previous one fails or returns no results:
 *
 *  1. Photon        (photon.komoot.io)               — OpenStreetMap data, browser-direct
 *  2. Open-Meteo    (geocoding-api.open-meteo.com)   — GeoNames data, browser-direct
 *  3. Nominatim     (via /.netlify/functions/geocode) — full OSM, proxied server-side
 *                    (browser can't set the User-Agent Nominatim requires, so we
 *                     go through a Netlify function that adds it)
 *
 * Returns null only if all three services fail or return no results.
 */
export async function geocodeLocation(query) {
  if (!query || query.trim().length === 0) return null;

  // ── 1. Photon ────────────────────────────────────────────────────────────
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en`
    );
    if (res.ok) {
      const geojson = await res.json();
      const feature = geojson?.features?.[0];
      if (feature) {
        const [longitude, latitude] = feature.geometry.coordinates;
        const p = feature.properties;
        return {
          latitude,
          longitude,
          displayName: [p.name, p.city, p.state, p.country].filter(Boolean).join(', '),
        };
      }
    }
  } catch { /* Photon unavailable — try next */ }

  // ── 2. Open-Meteo ────────────────────────────────────────────────────────
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      const r = data?.results?.[0];
      if (r) {
        return {
          latitude:    r.latitude,
          longitude:   r.longitude,
          displayName: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        };
      }
    }
  } catch { /* Open-Meteo unavailable — try next */ }

  // ── 3. Nominatim via Netlify proxy ───────────────────────────────────────
  try {
    const res = await fetch(
      `/.netlify/functions/geocode?q=${encodeURIComponent(query)}`
    );
    if (res.ok) {
      const data = await res.json();
      const r = data?.[0];
      if (r) {
        const addr = r.address || {};
        const displayName = [
          addr.city || addr.town || addr.village || addr.county || r.name,
          addr.state,
          addr.country,
        ].filter(Boolean).join(', ');
        return {
          latitude:  parseFloat(r.lat),
          longitude: parseFloat(r.lon),
          displayName,
        };
      }
    }
  } catch (err) {
    console.error('[geocode] All three geocoders failed:', err);
  }

  return null;
}
