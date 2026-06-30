/**
 * ProvinceBrowser.jsx
 * "Browse by Province" chip grid — modelled after Crosssa's Search.tsx.
 * Used by both SearchVehicles.jsx and FindDrivers.jsx so neither page
 * auto-loads results; the user must pick a province first.
 *
 * Each province maps to its largest city's coordinates, used as the
 * center point for a 50km radius search via the nearby_* RPC functions.
 *
 * Smart geolocation: if the user picks the province they are physically
 * located in (detected via browser geolocation, reverse-matched to the
 * nearest province), the search centers on their EXACT location instead
 * of the province's main city — since most users search near themselves.
 * Picking any other province always centers on that province's main city.
 *
 * Place at: src/components/search/ProvinceBrowser.jsx
 */
import React, { useState, useEffect, useRef } from 'react';
import { Zap, CheckCircle2, SlidersHorizontal, MapPin, LocateFixed } from 'lucide-react';

// Main city per province — used as the radius search center point
export const PROVINCES = [
  { name: 'Gauteng',        city: 'Johannesburg', lat: -26.2041, lng: 28.0473 },
  { name: 'Western Cape',   city: 'Cape Town',     lat: -33.9249, lng: 18.4241 },
  { name: 'KwaZulu-Natal',  city: 'Durban',        lat: -29.8587, lng: 31.0218 },
  { name: 'Eastern Cape',   city: 'Gqeberha',      lat: -33.9608, lng: 25.6022 },
  { name: 'Free State',     city: 'Bloemfontein',  lat: -29.0852, lng: 26.1596 },
  { name: 'Mpumalanga',     city: 'Mbombela',      lat: -25.4753, lng: 30.9694 },
  { name: 'Limpopo',        city: 'Polokwane',     lat: -23.9045, lng: 29.4689 },
  { name: 'North West',     city: 'Rustenburg',    lat: -25.6672, lng: 27.2424 },
  { name: 'Northern Cape',  city: 'Kimberley',     lat: -28.7282, lng: 24.7499 },
];

export const SEARCH_RADIUS_KM = 50;

// Haversine distance in km — used to find the nearest province to the user
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestProvince(lat, lng) {
  let nearest = null;
  let minDist = Infinity;
  for (const p of PROVINCES) {
    const d = distanceKm(lat, lng, p.lat, p.lng);
    if (d < minDist) { minDist = d; nearest = p; }
  }
  return nearest;
}

export default function ProvinceBrowser({ onSelectProvince, mode = 'vehicles', howItWorks }) {
  const subjectLabel = mode === 'vehicles' ? 'vehicles' : 'drivers';
  const [userCoords, setUserCoords] = useState(null);
  const [userProvince, setUserProvince] = useState(null); // the province the user is physically in
  const geoRequested = useRef(false);

  // Silently request geolocation once on mount — used only to detect which
  // province the user is in, so tapping THAT chip uses their exact location.
  useEffect(() => {
    if (geoRequested.current || !navigator.geolocation) return;
    geoRequested.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserCoords(coords);
        setUserProvince(findNearestProvince(coords.latitude, coords.longitude));
      },
      () => { /* denied/unavailable — falls back to main-city search for every province */ },
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  const handleClick = (province) => {
    // If this is the user's own (nearest) province AND we have their exact
    // coords, search around them directly instead of the main city.
    if (userProvince && province.name === userProvince.name && userCoords) {
      onSelectProvince({
        ...province,
        lat: userCoords.latitude,
        lng: userCoords.longitude,
        isUserLocation: true,
      });
    } else {
      onSelectProvince(province);
    }
  };

  return (
    <div className="space-y-4">
      {/* Province chips */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Browse by Province</p>
        <div className="flex flex-wrap gap-2">
          {PROVINCES.map(p => {
            const isMine = userProvince && p.name === userProvince.name;
            return (
              <button
                key={p.name}
                onClick={() => handleClick(p)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors font-medium flex items-center gap-1 ${
                  isMine
                    ? 'border-primary text-primary bg-primary/5 hover:bg-primary/10'
                    : 'border-border bg-card hover:border-primary hover:text-primary text-muted-foreground'
                }`}
              >
                {isMine && <LocateFixed className="w-3 h-3" />}
                {p.name}
              </button>
            );
          })}
        </div>
        {userProvince && (
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
            <LocateFixed className="w-3 h-3 text-primary" />
            We'll search near your exact location for <strong className="text-foreground">{userProvince.name}</strong> — other provinces search around their main city.
          </p>
        )}
      </div>

      {/* How it works */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <p className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> How Search Works
        </p>
        <div className="space-y-3">
          {(howItWorks || [
            { icon: CheckCircle2,      title: 'Pick a province',        desc: `Tap a province above to see ${subjectLabel} within ${SEARCH_RADIUS_KM} km. Your own province searches near you — others search around the main city.` },
            { icon: SlidersHorizontal, title: 'Refine with filters',     desc: 'Use filters to narrow down by price, type, rating and more.' },
            { icon: MapPin,            title: 'Search a specific town',  desc: 'Type a town name in the location filter for a more precise radius search.' },
          ]).map(({ icon: Icon, title, desc }, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
