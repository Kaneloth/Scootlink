// src/components/home/OwnerAttention.jsx
//
// Top of the owner's Home: vehicles that need something done — an unfinished
// listing (removed after 7 days), a listing about to end or ended, or a
// roadworthy certificate that was rejected or has expired. Hidden when
// everything is in order.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, ChevronRight, Plus } from 'lucide-react';
import { supabase } from '@/api/supabaseData';

const DAY = 86400000;
const shortDay = (d) => new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });

function issuesFor(v) {
  const out = [];
  const rental = ['rental', 'both'].includes(v.listing_purpose);
  const gigs = ['gigs', 'both'].includes(v.listing_purpose);
  if (v.draft_expires_at) {
    out.push({ urgent: true, text: `Not listed yet — finish by ${shortDay(v.draft_expires_at)} or it's removed` });
  } else if (rental && v.listing_state === 'active' && v.expires_at) {
    const days = Math.ceil((new Date(v.expires_at) - Date.now()) / DAY);
    if (days <= 7) out.push({ urgent: days <= 3, text: `Listing ends in ${Math.max(days, 0)} day${days === 1 ? '' : 's'} — extend it` });
  } else if (rental && v.listing_state === 'expired') {
    out.push({ urgent: false, text: 'Listing ended — hidden from drivers. Relist it' });
  }
  if (gigs && v.ride_ready_status === 'rejected') out.push({ urgent: true, text: 'Roadworthy certificate not approved — resubmit' });
  if (gigs && v.ride_ready_status === 'expired') out.push({ urgent: true, text: 'Roadworthy certificate expired — upload a new one' });
  return out;
}

export default function OwnerAttention({ userId }) {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState(null);

  useEffect(() => {
    if (!userId) return;
    supabase.from('vehicles')
      .select('id, make, model, plate, listing_purpose, listing_state, expires_at, draft_expires_at, ride_ready_status')
      .eq('owner_id', userId)
      .then(({ data, error }) => {
        if (error) console.error('[OwnerAttention] load failed:', error);
        setVehicles(data || []);
      });
  }, [userId]);

  if (vehicles === null) return null;

  if (vehicles.length === 0) {
    return (
      <button
        onClick={() => navigate('/add-vehicle')}
        className="w-full flex items-center gap-3 p-4 mb-4 rounded-2xl bg-primary text-primary-foreground text-left shadow-md"
      >
        <Plus className="w-6 h-6 shrink-0" />
        <span className="flex-1">
          <span className="block font-semibold">List your first vehicle</span>
          <span className="block text-xs opacity-80">Your first rental listing is free</span>
        </span>
        <ChevronRight className="w-5 h-5 opacity-80" />
      </button>
    );
  }

  const items = vehicles.flatMap((v) => issuesFor(v).map((i, n) => ({ ...i, v, key: `${v.id}-${n}` })))
    .sort((a, b) => Number(b.urgent) - Number(a.urgent));
  if (!items.length) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 mb-4 space-y-1">
      <p className="text-sm font-semibold text-amber-900 px-1 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4" /> Needs your attention
      </p>
      {items.map(({ v, text, urgent, key }) => (
        <button
          key={key}
          onClick={() => navigate(`/vehicle-listing/${v.id}`)}
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-amber-100 text-left"
        >
          {urgent ? <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" /> : <Clock className="w-4 h-4 text-amber-700 shrink-0" />}
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-amber-950 truncate">{v.make} {v.model}{v.plate ? ` · ${v.plate}` : ''}</span>
            <span className="block text-xs text-amber-800">{text}</span>
          </span>
          <ChevronRight className="w-4 h-4 text-amber-700" />
        </button>
      ))}
    </div>
  );
}
