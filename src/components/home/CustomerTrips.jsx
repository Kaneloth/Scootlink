// src/components/home/CustomerTrips.jsx
//
// The 'Trips' tab for customers (it sits in the Search slot of the bottom
// nav): every ride and delivery they requested, newest first.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Package, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { gigStateLabel, rand, shortDate, OPEN_GIG_STATUSES } from './gigLabels';

export default function CustomerTrips() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setTrips([]); return; }
      const { data, error } = await supabase
        .from('gig_requests')
        .select('id, gig_type, status, fare_amount, payment_method, pickup_address, dropoff_address, created_at, driver_arrived_at, driver_completed_at')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) console.error('[CustomerTrips] load failed:', error);
      setTrips(data || []);
    })();
  }, []);

  const open = (trips || []).filter((t) => OPEN_GIG_STATUSES.includes(t.status));
  const past = (trips || []).filter((t) => !OPEN_GIG_STATUSES.includes(t.status));

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <div className="sticky top-0 z-30 -mx-4 -mt-4 px-4 pt-4 pb-3 mb-4 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-8 bg-background/95 backdrop-blur border-b border-border/60 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Trips</h1>
        <Button size="sm" className="gap-1.5" onClick={() => navigate('/request-gig')}>
          <Plus className="w-4 h-4" /> New
        </Button>
      </div>

      {trips === null && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

      {trips?.length === 0 && (
        <div className="text-center py-12 space-y-3">
          <p className="text-muted-foreground text-sm">No trips yet.</p>
          <Button onClick={() => navigate('/request-gig')}>Request a ride or delivery</Button>
        </div>
      )}

      {open.length > 0 && <TripGroup title="In progress" trips={open} onOpen={(id) => navigate(`/gig-status/${id}`)} highlight />}
      {past.length > 0 && <TripGroup title="Past" trips={past} onOpen={(id) => navigate(`/gig-status/${id}`)} />}
    </div>
  );
}

function TripGroup({ title, trips, onOpen, highlight = false }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-muted-foreground mb-2">{title}</h2>
      <div className="space-y-2">
        {trips.map((t) => (
          <button
            key={t.id}
            onClick={() => onOpen(t.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}
          >
            {t.gig_type === 'ride' ? <Car className="w-5 h-5 text-muted-foreground shrink-0" /> : <Package className="w-5 h-5 text-muted-foreground shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium truncate">{t.dropoff_address || t.pickup_address}</span>
              <span className="block text-xs text-muted-foreground truncate">from {t.pickup_address}</span>
              <span className="block text-xs text-muted-foreground">
                {shortDate(t.created_at)} · {gigStateLabel(t, false)}
              </span>
            </span>
            <span className="text-right shrink-0">
              {t.fare_amount != null && <span className="block text-sm font-semibold">{rand(t.fare_amount)}</span>}
              {t.payment_method && <span className="block text-[11px] text-muted-foreground capitalize">{t.payment_method}</span>}
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
