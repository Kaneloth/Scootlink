/**
 * Geocode a free-form location string into { latitude, longitude, displayName }.
 * Uses the free Nominatim API (OpenStreetMap). Returns null on failure.
 *
 * Nominatim usage policy requires:
 *  - A descriptive User-Agent with contact info (otherwise requests get rejected)
 *  - Max 1 request/second — debounce or cache calls on high-traffic pages
 */
export async function geocodeLocation(query) {
  if (!query || query.trim().length === 0) return null;

  // No countrycodes restriction — keeps international searches working and
  // avoids edge cases where Nominatim can't resolve a South African place name
  // with the restriction in place.
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

  try {
    const res = await fetch(url, {
      headers: {
        // Required by Nominatim's usage policy — must identify the application
        'User-Agent':      'Skootlink/1.0 (support@skootlink.com)',
        'Accept-Language': 'en',
      },
    });

    if (!res.ok) {
      console.error('Geocoding HTTP error', res.status, res.statusText);
      return null;
    }

    const data = await res.json();

    if (data && data.length > 0) {
      return {
        latitude:    parseFloat(data[0].lat),
        longitude:   parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    }
  } catch (err) {
    console.error('Geocoding network error', err);
  }

  return null;
}
