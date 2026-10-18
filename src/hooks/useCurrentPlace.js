// src/hooks/useCurrentPlace.js
//
// The user's current area ("Rondebosch, Cape Town") for the Home header, from
// the device location + reverse geocoding. Remembered for 10 minutes per app
// session so switching tabs doesn't ask again. Falls back to the location on
// the profile when location access is off or unavailable.

import { useEffect, useState } from 'react';
import { reverseGeocode } from '@/lib/geocode';

const KEY = 'skootlink_current_place';
const TTL = 10 * 60 * 1000;

function cached() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return v && Date.now() - v.at < TTL ? v.label : null;
  } catch { return null; }
}

export default function useCurrentPlace(profileLocation, refreshKey = 0) {
  const fallback = profileLocation ? profileLocation.split(',').slice(0, 2).join(',').trim() : null;
  const [state, setState] = useState(() => ({ label: cached(), locating: !cached() }));

  useEffect(() => {
    if (refreshKey === 0 && cached()) return undefined;
    if (!navigator.geolocation) { setState({ label: null, locating: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, locating: true }));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const place = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        if (!alive) return;
        if (place) {
          try { sessionStorage.setItem(KEY, JSON.stringify({ label: place.short, at: Date.now() })); } catch { /* private mode */ }
        }
        setState({ label: place?.short || null, locating: false });
      },
      () => { if (alive) setState({ label: null, locating: false }); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
    return () => { alive = false; };
  }, [refreshKey]);

  return { label: state.label || (state.locating ? null : fallback), locating: state.locating, isLive: !!state.label };
}
