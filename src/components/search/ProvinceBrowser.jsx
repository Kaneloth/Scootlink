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
import { supabase } from '@/api/supabaseClient';

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

// Coordinates for every city/town in the province lists.
// Used to centre the 50km radius search on the user's actual saved city
// rather than always falling back to the province main city.
const CITY_COORDS = {
  // Eastern Cape
  'Aliwal North': { lat: -30.6892, lng: 26.7138 }, 'Bhisho': { lat: -32.8479, lng: 27.4386 },
  'East London': { lat: -33.0153, lng: 27.9116 }, 'Gqeberha (Port Elizabeth)': { lat: -33.9608, lng: 25.6022 },
  'Grahamstown': { lat: -33.3042, lng: 26.5328 }, 'Humansdorp': { lat: -34.0326, lng: 24.7688 },
  'Jeffreys Bay': { lat: -34.0527, lng: 24.9181 }, "King William's Town": { lat: -32.8767, lng: 27.3897 },
  'Mthatha': { lat: -31.5891, lng: 28.7847 }, 'Port Alfred': { lat: -33.5931, lng: 26.8913 },
  'Queenstown': { lat: -31.8987, lng: 26.8749 }, 'Stutterheim': { lat: -32.5655, lng: 27.4145 },
  // Free State
  'Bethlehem': { lat: -28.2314, lng: 28.3080 }, 'Bloemfontein': { lat: -29.0852, lng: 26.1596 },
  'Ficksburg': { lat: -28.8741, lng: 27.8794 }, 'Harrismith': { lat: -28.2752, lng: 29.1227 },
  'Kroonstad': { lat: -27.6503, lng: 27.2322 }, 'Parys': { lat: -26.9066, lng: 27.4558 },
  'Phuthaditjhaba': { lat: -28.5316, lng: 28.9289 }, 'Sasolburg': { lat: -26.8128, lng: 27.8288 },
  'Virginia': { lat: -28.1072, lng: 26.8682 }, 'Welkom': { lat: -27.9916, lng: 26.7344 },
  // Gauteng
  'Alberton': { lat: -26.2654, lng: 28.1228 }, 'Benoni': { lat: -26.1872, lng: 28.3198 },
  'Boksburg': { lat: -26.2144, lng: 28.2601 }, 'Carletonville': { lat: -26.3587, lng: 27.4004 },
  'Centurion': { lat: -25.8553, lng: 28.1759 }, 'Edenvale': { lat: -26.1384, lng: 28.1579 },
  'Fourways': { lat: -26.0183, lng: 28.0098 }, 'Germiston': { lat: -26.2169, lng: 28.1681 },
  'Johannesburg': { lat: -26.2041, lng: 28.0473 }, 'Kempton Park': { lat: -26.1022, lng: 28.2285 },
  'Midrand': { lat: -25.9985, lng: 28.1284 }, 'Pretoria': { lat: -25.7461, lng: 28.1881 },
  'Randburg': { lat: -26.0931, lng: 27.9994 }, 'Randfontein': { lat: -26.1816, lng: 27.6953 },
  'Roodepoort': { lat: -26.1625, lng: 27.8728 }, 'Sandton': { lat: -26.1070, lng: 28.0567 },
  'Soweto': { lat: -26.2677, lng: 27.8591 }, 'Springs': { lat: -26.2561, lng: 28.4375 },
  'Vanderbijlpark': { lat: -26.6994, lng: 27.8399 }, 'Vereeniging': { lat: -26.6736, lng: 27.9319 },
  // KwaZulu-Natal
  'Ballito': { lat: -29.5392, lng: 31.2108 }, 'Durban': { lat: -29.8587, lng: 31.0218 },
  'Empangeni': { lat: -28.7252, lng: 31.8990 }, 'Kloof': { lat: -29.7809, lng: 30.8381 },
  'Ladysmith': { lat: -28.5604, lng: 29.7777 }, 'Margate': { lat: -30.8640, lng: 30.3567 },
  'Newcastle': { lat: -27.7559, lng: 29.9314 }, 'Pietermaritzburg': { lat: -29.6006, lng: 30.3794 },
  'Pinetown': { lat: -29.8213, lng: 30.8612 }, 'Port Shepstone': { lat: -30.7412, lng: 30.4547 },
  'Richards Bay': { lat: -28.7829, lng: 32.0617 }, 'Stanger': { lat: -29.3461, lng: 31.2994 },
  'Ulundi': { lat: -28.3279, lng: 31.4160 }, 'Umhlanga': { lat: -29.7267, lng: 31.0824 },
  'Vryheid': { lat: -27.7693, lng: 30.7917 }, 'Westville': { lat: -29.8328, lng: 30.9316 },
  // Limpopo
  'Bela-Bela': { lat: -24.8853, lng: 28.2906 }, 'Giyani': { lat: -23.3027, lng: 30.7196 },
  'Louis Trichardt': { lat: -23.0442, lng: 29.9048 }, 'Modimolle': { lat: -24.7013, lng: 28.4084 },
  'Mokopane': { lat: -24.1848, lng: 28.9996 }, 'Musina': { lat: -22.3402, lng: 30.0449 },
  'Phalaborwa': { lat: -23.9441, lng: 31.1410 }, 'Polokwane': { lat: -23.9045, lng: 29.4689 },
  'Thohoyandou': { lat: -22.9500, lng: 30.4833 }, 'Tzaneen': { lat: -23.8323, lng: 30.1569 },
  // Mpumalanga
  'Barberton': { lat: -25.7878, lng: 31.0503 }, 'Ermelo': { lat: -26.5241, lng: 29.9827 },
  'Graskop': { lat: -24.9347, lng: 30.8358 }, 'Hazyview': { lat: -25.0499, lng: 31.1292 },
  'Komatipoort': { lat: -25.4329, lng: 31.9494 }, 'Malelane': { lat: -25.4698, lng: 31.5330 },
  'Mbombela (Nelspruit)': { lat: -25.4753, lng: 30.9694 }, 'Middelburg': { lat: -25.7742, lng: 29.4616 },
  'Piet Retief': { lat: -27.0097, lng: 30.8102 }, 'Sabie': { lat: -25.0975, lng: 30.7821 },
  'Secunda': { lat: -26.5232, lng: 29.1788 }, 'Witbank (eMalahleni)': { lat: -25.8731, lng: 29.2428 },
  // North West
  'Brits': { lat: -25.6364, lng: 27.7847 }, 'Hartbeespoort': { lat: -25.7461, lng: 27.9020 },
  'Klerksdorp': { lat: -26.8537, lng: 26.6693 }, 'Lichtenburg': { lat: -26.1468, lng: 26.1599 },
  'Mahikeng': { lat: -25.8653, lng: 25.6438 }, 'Potchefstroom': { lat: -26.7145, lng: 27.1027 },
  'Rustenburg': { lat: -25.6672, lng: 27.2424 }, 'Wolmaransstad': { lat: -27.1950, lng: 25.9752 },
  'Zeerust': { lat: -25.5443, lng: 26.0768 },
  // Northern Cape
  'Colesberg': { lat: -30.7237, lng: 25.0935 }, 'De Aar': { lat: -30.6497, lng: 24.0105 },
  'Kathu': { lat: -27.7029, lng: 23.0491 }, 'Kimberley': { lat: -28.7282, lng: 24.7499 },
  'Kuruman': { lat: -27.4535, lng: 23.4318 }, 'Pofadder': { lat: -29.1274, lng: 19.4016 },
  'Springbok': { lat: -29.6649, lng: 17.8864 }, 'Upington': { lat: -28.4478, lng: 21.2561 },
  // Western Cape
  'Beaufort West': { lat: -32.3527, lng: 22.5840 }, 'Bellville': { lat: -33.9000, lng: 18.6297 },
  'Cape Town': { lat: -33.9249, lng: 18.4241 }, 'Durbanville': { lat: -33.8299, lng: 18.6476 },
  'George': { lat: -33.9630, lng: 22.4617 }, 'Hermanus': { lat: -34.4147, lng: 19.2354 },
  'Knysna': { lat: -34.0363, lng: 23.0489 }, 'Malmesbury': { lat: -33.4601, lng: 18.7267 },
  'Mossel Bay': { lat: -34.1831, lng: 22.1444 }, 'Oudtshoorn': { lat: -33.5900, lng: 22.2005 },
  'Paarl': { lat: -33.7313, lng: 18.9629 }, 'Saldanha': { lat: -33.0115, lng: 17.9435 },
  'Somerset West': { lat: -34.0855, lng: 18.8483 }, 'Stellenbosch': { lat: -33.9328, lng: 18.8602 },
  'Strand': { lat: -34.1167, lng: 18.8333 }, 'Swellendam': { lat: -34.0226, lng: 20.4397 },
  'Vredenburg': { lat: -32.9098, lng: 17.9940 }, 'Worcester': { lat: -33.6457, lng: 19.4472 },
};

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
  const [userProvince, setUserProvince] = useState(null);
  const [profileCityName, setProfileCityName] = useState(null); // the city from profile location
  const geoRequested = useRef(false);

  useEffect(() => {
    (async () => {
      // ── 1. Read profile location ─────────────────────────────────────────
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('location')
            .eq('id', uid)
            .single();

          if (profile?.location) {
            // Location string format: "City, Province, South Africa"
            const parts = profile.location.split(',').map(p => p.trim());
            const provincePart = parts.length >= 2 ? parts[parts.length >= 3 ? parts.length - 2 : 1] : null;
            const cityPart = parts[0] || null;
            const matched = provincePart
              ? PROVINCES.find(p => p.name.toLowerCase() === provincePart.toLowerCase())
              : null;
            if (matched) {
              setUserProvince(matched);
              setProfileCityName(cityPart); // e.g. "Kroonstad"
            }
          }
        }
      } catch { /* non-fatal */ }

      // ── 2. Request GPS for exact coords within same province ─────────────
      if (geoRequested.current || !navigator.geolocation) return;
      geoRequested.current = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setUserCoords(coords);
        },
        () => { /* denied/unavailable */ },
        { timeout: 8000, maximumAge: 5 * 60 * 1000 },
      );
    })();
  }, []);

  const handleClick = async (province) => {
    const isMyProvince = userProvince && province.name === userProvince.name;

    console.log('[ProvinceBrowser] click:', province.name, '| userProvince:', userProvince?.name, '| profileCityName:', profileCityName, '| isMyProvince:', isMyProvince);

    if (isMyProvince) {
      // GPS is physically in same province — use exact GPS coords
      const gpsProvince = userCoords ? findNearestProvince(userCoords.latitude, userCoords.longitude) : null;
      console.log('[ProvinceBrowser] GPS province:', gpsProvince?.name, '| userCoords:', userCoords);

      if (userCoords && gpsProvince?.name === province.name) {
        onSelectProvince({ ...province, lat: userCoords.latitude, lng: userCoords.longitude, isUserLocation: true });
        return;
      }

      // Profile has a specific city — look up hardcoded coords
      if (profileCityName) {
        const cityCoords = CITY_COORDS[profileCityName];
        console.log('[ProvinceBrowser] profileCityName:', profileCityName, '| cityCoords:', cityCoords);
        if (cityCoords) {
          onSelectProvince({ ...province, lat: cityCoords.lat, lng: cityCoords.lng, isUserLocation: true, locationLabel: profileCityName });
          return;
        }
      }
    }

    console.log('[ProvinceBrowser] falling back to main city:', province.city, province.lat, province.lng);
    onSelectProvince(province);
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
            Based on your profile location — <strong className="text-foreground">{userProvince.name}</strong> is highlighted. Update your profile to change this.
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
