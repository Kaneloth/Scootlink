/**
 * ProvinceBrowser.jsx
 * "Browse by Province" chip grid — modelled after Crosssa's Search.tsx.
 * Used by both SearchVehicles.jsx and FindDrivers.jsx so neither page
 * auto-loads results; the user must pick a province first.
 *
 * Each province maps to its largest city's coordinates, used as the
 * center point for a 50km radius search via the nearby_* RPC functions.
 *
 * Place at: src/components/search/ProvinceBrowser.jsx
 */
import React from 'react';
import { Zap, CheckCircle2, SlidersHorizontal, MapPin } from 'lucide-react';

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

export default function ProvinceBrowser({ onSelectProvince, mode = 'vehicles', howItWorks }) {
  const subjectLabel = mode === 'vehicles' ? 'vehicles' : 'drivers';

  return (
    <div className="space-y-4">
      {/* Province chips */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Browse by Province</p>
        <div className="flex flex-wrap gap-2">
          {PROVINCES.map(p => (
            <button
              key={p.name}
              onClick={() => onSelectProvince(p)}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:border-primary hover:text-primary transition-colors text-muted-foreground font-medium"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <p className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> How Search Works
        </p>
        <div className="space-y-3">
          {(howItWorks || [
            { icon: CheckCircle2,      title: 'Pick a province',        desc: `Tap a province above to see ${subjectLabel} within ${SEARCH_RADIUS_KM} km of its main city.` },
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
