// src/components/gigs/IncomingGigOfferOverlay.jsx
//
// Global overlay showing incoming gig offers to a driver. Mount this
// ONCE near the app root — I don't have your AppLayout.jsx, so I can't
// place it precisely, but it needs to render regardless of which screen
// the driver is currently on (same idea as a notification bell). Likely
// spot: inside AppLayout.jsx, sibling to wherever notifications render.
//
// Styling follows the conventions in RentalRequest.jsx: shadcn/ui Card +
// Button, lucide-react icons, sonner toast for feedback. Deliberately
// NOT using a Dialog primitive — didn't want to assume it's part of
// your shadcn setup without seeing it used elsewhere; a fixed-position
// Card overlay achieves the same thing with only components already
// confirmed in use.

import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Car, Package, MapPin, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useGigOffers } from '@/hooks/useGigOffers';

// TODO: this needs to query the driver's currently-rented, Ride-Ready
// vehicles — e.g. rentals joined to vehicles where driver_id = driverId,
// vehicles.ride_ready_status = 'approved', and the rental is currently
// ACTIVE. Left as a stub: I don't know your rentals.status enum value
// for "active/ongoing" (RentalRequest.jsx only shows the 'pending' value
// on insert). Confirm the value and this becomes a one-line useQuery.
async function fetchDriversRideReadyVehicles(driverId) {
  console.warn('[IncomingGigOfferOverlay] fetchDriversRideReadyVehicles not yet implemented — rentals.status active-value unconfirmed');
  return [];
}

function OfferCard({ offer, driverId, onDismiss }) {
  const [accepting, setAccepting] = useState(false);
  const [vehicles, setVehicles] = useState(null); // null = not loaded, [] = loaded/empty
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);

  const isRide = offer.gig_type === 'ride';

  const handleAcceptTap = async () => {
    if (isRide && vehicles === null) {
      // First tap on a ride offer: load eligible vehicles before
      // actually accepting, since accept_gig_request requires a
      // vehicle_id for ride gigs.
      const list = await fetchDriversRideReadyVehicles(driverId);
      setVehicles(list);
      if (list.length === 0) {
        toast.error('No Ride-Ready vehicle available — you need an active rental on a Ride-Ready vehicle to accept ride gigs.');
      }
      return;
    }
    await doAccept();
  };

  const doAccept = async () => {
    if (isRide && !selectedVehicleId) {
      toast.error('Select a vehicle first');
      return;
    }
    setAccepting(true);
    try {
      const { error } = await supabase.rpc('accept_gig_request', {
        p_gig_id: offer.gig_id,
        p_vehicle_id: isRide ? selectedVehicleId : null,
      });

      if (error) {
        // "Gig no longer available" -> another driver won the race
        // (expected under broadcast-to-all — not an app error).
        if (error.message?.includes('no longer available')) {
          toast('Someone else got that one', { description: 'Keep an eye out for the next gig.' });
        } else {
          console.error('[IncomingGigOfferOverlay] accept_gig_request failed:', error);
          toast.error(error.message || 'Could not accept gig');
        }
        onDismiss(offer.gig_id);
        return;
      }

      toast.success('Gig accepted!');
      onDismiss(offer.gig_id);
      // TODO: navigate to an active-gig screen once that exists
      // (out of scope for this component — accept flow only).
    } catch (err) {
      console.error('[IncomingGigOfferOverlay] Unexpected accept error:', err);
      toast.error('Something went wrong. Please try again.');
      onDismiss(offer.gig_id);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Card className="p-4 border border-border/50 shadow-lg bg-background">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {isRide ? <Car className="w-5 h-5 text-primary" /> : <Package className="w-5 h-5 text-primary" />}
          <span className="font-semibold text-sm">{isRide ? 'Ride Request' : 'Delivery Request'}</span>
        </div>
        <button onClick={() => onDismiss(offer.gig_id)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1.5 mb-3 text-sm">
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
          <span className="text-muted-foreground">{offer.pickup_address}</span>
        </div>
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
          <span className="text-muted-foreground">{offer.dropoff_address}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        {(offer.distance_meters / 1000).toFixed(1)} km away
      </p>

      {isRide && vehicles !== null && vehicles.length > 0 && (
        <div className="mb-3 space-y-1">
          <p className="text-xs font-medium">Select vehicle:</p>
          {vehicles.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelectedVehicleId(v.id)}
              className={`w-full text-left text-sm p-2 rounded-lg border ${selectedVehicleId === v.id ? 'border-primary bg-primary/5' : 'border-border/50'}`}
            >
              {v.make} {v.model} ({v.plate})
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleAcceptTap}
          disabled={accepting || (isRide && vehicles?.length === 0)}
          className="flex-1 gap-2"
        >
          {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {accepting ? 'Accepting...' : isRide && vehicles === null ? 'Choose Vehicle' : 'Accept'}
        </Button>
      </div>
    </Card>
  );
}

export default function IncomingGigOfferOverlay({ driverId }) {
  const { offers, dismissOffer } = useGigOffers(driverId);

  if (!driverId || offers.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto space-y-2">
      {offers.map((offer) => (
        <OfferCard key={offer.gig_id} offer={offer} driverId={driverId} onDismiss={dismissOffer} />
      ))}
    </div>
  );
}
