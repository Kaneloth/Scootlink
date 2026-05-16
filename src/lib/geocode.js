export async function geocodeLocation(query) {
  if (!query || query.trim().length === 0) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=za`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'Skootlink/1.0' },
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        latitude:    parseFloat(data[0].lat),
        longitude:   parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    }
  } catch (err) {
    console.error('Geocoding failed', err);
  }
  return null;
}
