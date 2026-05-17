/**
 * Geocode a free-form location string into { latitude, longitude, displayName }.
 *
 * Three independent services are tried in order — the next is only called if
 * the previous one fails or returns no results:
 *
 *  1. Photon        (photon.komoot.io)               — OpenStreetMap data, browser-direct
 *  2. Open-Meteo    (geocoding-api.open-meteo.com)   — GeoNames data, browser-direct
 *  3. Nominatim     (via /.netlify/functions/geocode) — full OSM, proxied server-side
 *
 * If all three services return no results (e.g. due to a typo), a fuzzy
 * edit-distance check runs against a list of known South African place names.
 * If a close-enough match is found the corrected name is geocoded automatically.
 *
 * Returns null only if everything fails.
 */

// ── Known SA places for fuzzy correction ─────────────────────────────────────
const SA_PLACES = [
  'Pretoria', 'Johannesburg', 'Cape Town', 'Durban', 'Bloemfontein',
  'Port Elizabeth', 'East London', 'Nelspruit', 'Mbombela', 'Polokwane',
  'Kimberley', 'Pietermaritzburg', 'Rustenburg', 'Vanderbijlpark',
  'Vereeniging', 'Soweto', 'Benoni', 'Tembisa', 'Boksburg', 'Welkom',
  'Newcastle', 'Midrand', 'Sandton', 'Randburg', 'Roodepoort', 'Centurion',
  'Ekurhuleni', 'Tshwane', 'Witbank', 'Secunda', 'Klerksdorp',
  'Potchefstroom', 'Mahikeng', 'Mafikeng', 'Tzaneen', 'Thohoyandou',
  'Upington', 'Richards Bay', 'Ladysmith', 'Harrismith', 'Mthatha',
  'Queenstown', 'Stellenbosch', 'Paarl', 'George', 'Mossel Bay', 'Knysna',
  'Gqeberha', 'Phuthaditjhaba', 'Betlehem', 'Bethlehem', 'eMalahleni',
  'Springs', 'Alberton', 'Germiston', 'Krugersdorp', 'Randfontein',
  'Brakpan', 'Katlehong', 'Thokoza', 'Vosloorus',
];

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) {
      dp[i][j] = i === 0
        ? j
        : a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Returns the best-matching SA place name if within edit-distance tolerance,
 * or null if the query is already close enough to a real name (or no match).
 */
function fuzzyCorrect(query) {
  const words = query.trim().split(/\s+/);
  if (words.length > 3) return null; // Too long to be a city name typo

  const qLower = query.trim().toLowerCase();
  let bestName = null;
  let bestDist = Infinity;

  for (const place of SA_PLACES) {
    const dist = levenshtein(qLower, place.toLowerCase());
    // Allow 1 edit for names ≤6 chars, 2 for ≤10, 3 for longer
    const maxDist = place.length <= 6 ? 1 : place.length <= 10 ? 2 : 3;
    if (dist > 0 && dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      bestName = place;
    }
  }

  return bestName;
}

// ── Core geocoder (single attempt, no correction) ─────────────────────────────
async function _tryGeocode(query) {
  // 1. Photon
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
  } catch { /* Photon unavailable */ }

  // 2. Open-Meteo
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
  } catch { /* Open-Meteo unavailable */ }

  // 3. Nominatim via Netlify proxy
  try {
    const res = await fetch(
      `/.netlify/functions/geocode?q=${encodeURIComponent(query)}`
    );
    if (res.ok) {
      const data = await res.json();
      const r = data?.[0];
      if (r) {
        const addr = r.address || {};
        return {
          latitude:  parseFloat(r.lat),
          longitude: parseFloat(r.lon),
          displayName: [
            addr.city || addr.town || addr.village || addr.county || r.name,
            addr.state,
            addr.country,
          ].filter(Boolean).join(', '),
        };
      }
    }
  } catch { /* Nominatim unavailable */ }

  return null;
}

// ── Public export ─────────────────────────────────────────────────────────────
export async function geocodeLocation(query) {
  if (!query || query.trim().length === 0) return null;

  // First attempt with the query as typed
  const result = await _tryGeocode(query);
  if (result) return result;

  // All three services returned nothing — try fuzzy correction
  const corrected = fuzzyCorrect(query);
  if (corrected) {
    const retried = await _tryGeocode(corrected);
    if (retried) {
      // Override displayName so the UI shows the corrected spelling
      return { ...retried, displayName: retried.displayName || corrected };
    }
  }

  console.error('[geocode] All geocoders failed for query:', query);
  return null;
}
