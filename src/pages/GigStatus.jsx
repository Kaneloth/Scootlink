// src/pages/GigStatus.jsx
//
// destination: src/pages/GigStatus.jsx
//
// Shown after RequestGig.jsx submits successfully. Subscribes to the
// gig_requests row via Supabase Realtime postgres_changes (NOT the
// broadcast channel used for driver offers — different mechanism).
//
// REQUIRES: Realtime replication enabled for gig_requests in the
// Supabase dashboard (Database -> Replication). This is separate from
// RLS and separate from the broadcast channels used in useGigOffers.js —
// not yet confirmed on, flagged clearly rather than assumed.
//
// Falls back to a manual refetch on mount + a 5s poll as a safety net in
// case Realtime isn't wired up correctly, so this doesn't fail silently
// if that dashboard setting turns out to be off.

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Car, Package, MapPin, Star } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';

const STATUS_COPY = {
  pending: { title: 'Finding a driver...', sub: 'Searching nearby drivers' },
  accepted: { title: 'Driver found!', sub: null },
  in_progress: { title: 'Gig in progress', sub: null },
  completed: { title: 'Completed', sub: 'Thanks for using Skootlink' },
  no_drivers_available: { title: 'No drivers available', sub: 'No one nearby right now' },
  cancelled: { title: 'Cancelled', sub: null },
  disputed: { title: 'Under review', sub: 'Our team is looking into this' },
};

export default function GigStatus() {
  const { gigId } = useParams();
  const navigate = useNavigate();
  const [gig, setGig] = useState(null);
  const [driverProfile, setDriverProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchGig = useCallback(async () => {
    const { data, error } = await supabase
      .from('gig_requests')
      .select('*')
      .eq('id', gigId)
      .single();
    if (error) {
      console.error('[GigStatus] fetch failed:', error);
      return;
    }
    setGig(data);
    setLoading(false);

    if (data.driver_id && (!driverProfile || driverProfile.id !== data.driver_id)) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, phone, rating, avatar_url')
        .eq('id', data.driver_id)
        .maybeSingle();
      setDriverProfile(profile || null);
    }
  }, [gigId, driverProfile]);

  useEffect(() => {
    fetchGig();

    const channel = supabase
      .channel(`gig-status-${gigId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'gig_requests', filter: `id=eq.${gigId}` },
        (payload) => {
          setGig(payload.new);
          if (payload.new.status === 'accepted' && payload.old.status === 'pending') {
            toast.success('A driver accepted your gig!');
          }
        },
      )
      .subscribe();

    // Safety-net poll in case Realtime replication isn't enabled for this
    // table — see file header note. Harmless no-op overhead if Realtime
    // is working correctly and already keeping state current.
    const poll = setInterval(fetchGig, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigId]);

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!gig) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title="Gig Status" backTo="/home" />
        <p className="text-muted-foreground">Gig not found.</p>
      </div>
    );
  }

  const copy = STATUS_COPY[gig.status] || { title: gig.status, sub: null };
  const isRide = gig.gig_type === 'ride';

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title={isRide ? 'Ride' : 'Delivery'} backTo="/home" />

      <Card className="p-6 border border-border/50">
        <div className="flex items-center gap-3 mb-4">
          {gig.status === 'pending' ? (
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          ) : isRide ? (
            <Car className="w-6 h-6 text-primary" />
          ) : (
            <Package className="w-6 h-6 text-primary" />
          )}
          <div>
            <h3 className="font-semibold">{copy.title}</h3>
            {copy.sub && <p className="text-sm text-muted-foreground">{copy.sub}</p>}
          </div>
        </div>

        <div className="space-y-1.5 mb-4 text-sm">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
            <span className="text-muted-foreground">{gig.pickup_address}</span>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
            <span className="text-muted-foreground">{gig.dropoff_address}</span>
          </div>
        </div>

        {gig.fare_amount != null && (
          <p className="text-sm mb-4">
            Estimated fare: <span className="font-bold">R {gig.fare_amount}</span>
          </p>
        )}

        {gig.status === 'accepted' && driverProfile && (
          <div className="bg-muted rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{driverProfile.full_name}</p>
                {driverProfile.rating != null && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Star className="w-3 h-3 fill-current" /> {driverProfile.rating}
                  </p>
                )}
              </div>
            </div>
            {/* Messaging link intentionally omitted — depends on the
                context_type='gig' conversation-creation flow, which is a
                separate piece of work (§5.9) not yet built. */}
          </div>
        )}

        {gig.status === 'no_drivers_available' && (
          <Button onClick={() => navigate('/request-gig')} className="w-full">
            Try Again
          </Button>
        )}
      </Card>
    </div>
  );
}
