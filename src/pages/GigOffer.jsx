// src/pages/GigOffer.jsx
//
// Route: /gig-offer/:gigId — opened by tapping a "New ride/delivery request"
// push notification (or the bell). The live Realtime offer was missed while
// the app was closed, so this loads the offer with get_gig_offer (migration
// 013), which only returns it to a driver who was actually offered the gig.
// Shows the same OfferCard as the live overlay (vehicle picker + accept).

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { OfferCard } from '@/components/gigs/IncomingGigOfferOverlay';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

export default function GigOffer() {
  const { gigId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, offer: null, driverId: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const [me, { data, error }] = await Promise.all([
        auth.me(),
        supabase.rpc('get_gig_offer', { p_gig_id: Number(gigId) }),
      ]);
      if (!alive) return;
      if (error) console.error('[GigOffer] get_gig_offer failed:', error);
      setState({ loading: false, offer: (data && data[0]) || null, driverId: me?.id || null });
    })();
    return () => { alive = false; };
  }, [gigId]);

  if (state.loading) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { offer, driverId } = state;
  const available = offer && offer.status === 'pending';

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-4">
      <PageHeader title="Gig offer" backTo="/gigs" />

      {available ? (
        <OfferCard
          offer={offer}
          driverId={driverId}
          onDismiss={() => navigate('/gigs')}
        />
      ) : (
        <Card className="p-5 border border-border/50 space-y-3">
          <p className="font-semibold">This gig is no longer available</p>
          <p className="text-sm text-muted-foreground">
            {offer
              ? 'Another driver accepted it, or the customer cancelled. Stay online for the next one.'
              : 'This offer could not be found.'}
          </p>
          <Button variant="outline" className="w-full" onClick={() => navigate('/gigs')}>
            Back to Gigs
          </Button>
        </Card>
      )}
    </div>
  );
}
