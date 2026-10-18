// src/components/home/OpenGigCards.jsx
//
// Any unfinished gig the user is part of — as customer or as driver — at the
// very top of Home, so getting back to a live trip is one tap for every role.
// Refreshes live when the gig changes.

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Package, ChevronRight } from 'lucide-react';
import { supabase } from '@/api/supabaseData';
import { OPEN_GIG_STATUSES, gigStateLabel } from './gigLabels';

export default function OpenGigCards({ userId }) {
  const navigate = useNavigate();
  const [gigs, setGigs] = useState([]);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('gig_requests')
      .select('id, gig_type, status, customer_id, driver_id, pickup_address, dropoff_address, driver_arrived_at, driver_completed_at')
      .or(`customer_id.eq.${userId},driver_id.eq.${userId}`)
      .in('status', OPEN_GIG_STATUSES)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) { console.error('[OpenGigCards] load failed:', error); return; }
    setGigs(data || []);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userId) return undefined;
    const channel = supabase
      .channel(`home-open-gigs-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gig_requests', filter: `customer_id=eq.${userId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gig_requests', filter: `driver_id=eq.${userId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  if (!gigs.length) return null;

  return (
    <div className="space-y-2 mb-4">
      {gigs.map((g) => {
        const asDriver = g.driver_id === userId;
        const Icon = g.gig_type === 'ride' ? Car : Package;
        return (
          <button
            key={g.id}
            onClick={() => navigate(asDriver ? `/gig-drive/${g.id}` : `/gig-status/${g.id}`)}
            className="w-full flex items-center gap-3 text-left p-4 rounded-2xl bg-primary text-primary-foreground shadow-md active:scale-[0.99] transition-transform"
          >
            <span className="w-10 h-10 rounded-full bg-primary-foreground/15 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] uppercase tracking-wide opacity-80">
                {asDriver ? 'Your current gig' : g.gig_type === 'ride' ? 'Your ride' : 'Your delivery'}
              </span>
              <span className="block font-semibold">{gigStateLabel(g, asDriver)}</span>
              <span className="block text-xs opacity-80 truncate">{g.dropoff_address || g.pickup_address}</span>
            </span>
            <ChevronRight className="w-5 h-5 opacity-80" />
          </button>
        );
      })}
    </div>
  );
}
