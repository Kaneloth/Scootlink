// src/lib/geoPoint.js
//
// Reads a PostGIS point (e.g. gig_requests.pickup_geo_location) as returned
// by Supabase, and builds map links from it.
//
// Supabase returns geography columns either as a hex EWKB string
// (e.g. "0101000020E6100000...") or, in some setups, as a GeoJSON object
// ({ type: 'Point', coordinates: [lng, lat] }). Both are handled.

export function parsePoint(value) {
  if (!value) return null;

  if (typeof value === 'object' && value.type === 'Point' && Array.isArray(value.coordinates)) {
    const [lng, lat] = value.coordinates;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  if (typeof value !== 'string' || !/^[0-9a-fA-F]+$/.test(value) || value.length < 42) return null;

  try {
    const bytes = new Uint8Array(value.match(/../g).map((h) => parseInt(h, 16)));
    const view = new DataView(bytes.buffer);
    const little = view.getUint8(0) === 1;
    const type = view.getUint32(1, little);
    const hasSrid = (type & 0x20000000) !== 0;
    if ((type & 0xff) !== 1) return null; // not a Point
    const offset = hasSrid ? 9 : 5;
    const lng = view.getFloat64(offset, little);
    const lat = view.getFloat64(offset + 8, little);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch (err) {
    console.error('[geoPoint] could not parse point:', err);
    return null;
  }
}

// Google Maps turn-by-turn directions to a point (falls back to the address).
// On Android this opens the Maps app when installed.
export function directionsUrl(point, fallbackAddress) {
  const destination = point ? `${point.lat},${point.lng}` : fallbackAddress;
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
