// src/lib/driverAvailability.js
//
// "Available for Gigs" tracking. Module-level store (not a React hook) so
// location reporting survives navigating between pages — only a full page
// reload / closing the app ends it. Components read it with
// useSyncExternalStore(subscribe, getSnapshot).
//
// How it works: browser geolocation (watchPosition) keeps the latest fix in
// memory; every PUSH_INTERVAL_MS the latest fix is sent through the
// update_driver_location RPC. Matching ignores locations older than 2 minutes
// (find_nearby_eligible_drivers), so a driver who closes the app drops out of
// matching on their own.
//
// LIMITS (be aware when testing):
//  - Foreground only. Mobile browsers/WebViews pause geolocation when the app
//    is backgrounded or the screen locks, so the driver must keep Skootlink
//    open and on-screen while online. True background tracking needs a native
//    foreground-service plugin — separate piece of work.
//  - Plain browser geolocation is used. Whether it works inside the Android
//    WebView depends on the location permission being declared/granted in the
//    native app; untested here.

import { supabase } from '@/api/supabaseData';

const PUSH_INTERVAL_MS = 10_000;
const FIX_MAX_AGE_MS = 60_000;        // don't advertise a position older than this
const RESUME_MAX_AGE_MS = 2 * 60_000; // matches the server-side freshness window

let state = { status: 'off', error: null }; // status: 'off' | 'starting' | 'on'
const listeners = new Set();

let watchId = null;
let timer = null;
let lastPos = null;   // { lat, lng }
let lastFixAt = 0;

const setState = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getSnapshot = () => state;

async function push() {
  if (!lastPos) return false;
  if (Date.now() - lastFixAt > FIX_MAX_AGE_MS) return false; // GPS lost: let server-side freshness drop us
  const { error } = await supabase.rpc('update_driver_location', {
    p_lat: lastPos.lat,
    p_lng: lastPos.lng,
    p_is_available: true,
  });
  if (error) {
    console.error('[driverAvailability] update_driver_location failed:', error);
    setState({ error: 'Could not update your location — check your connection' });
    return false;
  }
  if (state.error) setState({ error: null });
  return true;
}

function teardownLocal() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (timer !== null) { clearInterval(timer); timer = null; }
  lastPos = null;
  lastFixAt = 0;
  setState({ status: 'off' });
}

export function startAvailability() {
  if (state.status !== 'off') return;
  if (!navigator.geolocation) {
    setState({ error: 'Location is not available on this device' });
    return;
  }
  setState({ status: 'starting', error: null });

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const isFirstFix = lastPos === null;
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      lastFixAt = Date.now();
      if (!isFirstFix) return;

      // First fix: go live only once the server accepted our position
      const ok = await push();
      if (ok) {
        setState({ status: 'on', error: null });
        timer = setInterval(push, PUSH_INTERVAL_MS);
      } else {
        teardownLocal();
        setState({ error: state.error || 'Could not go online — please try again' });
      }
    },
    (err) => {
      console.warn('[driverAvailability] geolocation error:', err.code, err.message);
      if (err.code === 1) {
        // Permission denied — can't continue at all
        teardownLocal();
        setState({ error: 'Location permission denied. Allow location access to go online.' });
      } else if (state.status === 'starting') {
        teardownLocal();
        setState({ error: 'Could not get your location. Check GPS/signal and try again.' });
      }
      // Transient errors while already online: keep going; push() stops
      // advertising once the last fix is older than FIX_MAX_AGE_MS.
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
}

export async function stopAvailability() {
  teardownLocal();
  const { error } = await supabase.rpc('set_driver_unavailable');
  if (error) console.error('[driverAvailability] set_driver_unavailable failed:', error);
}

// After a page reload: if the DB says we were online a moment ago, pick back up.
export async function resumeIfWasAvailable(driverId) {
  if (state.status !== 'off' || !driverId) return;
  const { data, error } = await supabase
    .from('driver_live_locations')
    .select('is_available, updated_at')
    .eq('driver_id', driverId)
    .maybeSingle();
  if (error) { console.error('[driverAvailability] resume check failed:', error); return; }
  if (data?.is_available && Date.now() - new Date(data.updated_at).getTime() < RESUME_MAX_AGE_MS) {
    startAvailability();
  }
}

// Signing out must stop reporting locally (the RPC would be rejected anyway
// once the session is gone; server-side freshness handles the DB row).
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') teardownLocal();
});
