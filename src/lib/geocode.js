/**
 * Geocode a free-form location string into { latitude, longitude, displayName }.
 *
 * Primary:  Photon (photon.komoot.io) — OpenStreetMap data, works from browser.
 * Fallback: Open-Meteo geocoding API — free, no API key, highly reliable.
 *
 * The fallback fires automatically if Photon is down or returns an error,
 * so a temporary Photon outage never shows "location not found" to the user.
 *
 * Returns null only if both services fail or return no results.
 */
export async function geocodeLocation(query) {
  if (!query || query.trim().length === 0) return null;

  // ── Primary: Photon ──────────────────────────────────────────────────────
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
  } catch { /* Photon unavailable — fall through to backup */ }

  // ── Fallback: Open-Meteo Geocoding ───────────────────────────────────────
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.results?.[0];
    if (!r) return null;
    return {
      latitude:    r.latitude,
      longitude:   r.longitude,
      displayName: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    };
  } catch (err) {
    console.error('[geocode] Both Photon and Open-Meteo failed:', err);
  }

  return null;
}
