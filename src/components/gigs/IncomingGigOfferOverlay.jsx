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
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Car, Package, MapPin, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useGigOffers } from '@/hooks/useGigOffers';
import { notify } from '@/lib/notify';

// The Ride-Ready approved vehicles this driver may use for a ride:
//   - vehicles they currently rent (rentals.status = 'active'), and
//   - vehicles they own, unless that vehicle is actively rented out to
//     someone else (the renter has it).
// Status 'active' is the value Activity.jsx and AdminRentalsOversight.jsx use.
//
// Plain queries instead of a PostgREST embed, so this doesn't depend on a
// rentals.vehicle_id -> vehicles.id foreign key existing.
// The server (accept_gig_request, migration 008) enforces the same rule;
// this list is only what the driver gets to choose from.
async function fetchDriversRideReadyVehicles(driverId) {
  if (!driverId) return [];

  const [rentingRes, rentedOutRes, ownedRes] = await Promise.all([
    // Vehicles this driver is renting
    supabase.from('rentals').select('vehicle_id')
      .eq('driver_id', driverId).eq('status', 'active'),
    // This driver's own vehicles that someone else is renting right now
    supabase.from('rentals').select('vehicle_id, driver_id')
      .eq('owner_id', driverId).eq('status', 'active'),
    // This driver's own Ride-Ready vehicles
    supabase.from('vehicles').select('id, make, model, plate')
      .eq('owner_id', driverId).eq('ride_ready_status', 'approved'),
  ]);

  for (const [label, res] of [['renting', rentingRes], ['rented-out', rentedOutRes], ['owned', ownedRes]]) {
    if (res.error) {
      console.error(`[IncomingGigOfferOverlay] fetchDriversRideReadyVehicles ${label} query failed:`, res.error);
      return [];
    }
  }

  const rentedOutToOthers = new Set(
    (rentedOutRes.data || []).filter((r) => r.driver_id !== driverId).map((r) => r.vehicle_id),
  );
  const ownedUsable = (ownedRes.data || []).filter((v) => !rentedOutToOthers.has(v.id));

  const rentingIds = [...new Set((rentingRes.data || []).map((r) => r.vehicle_id).filter(Boolean))]
    .filter((id) => !ownedUsable.some((v) => v.id === id));

  let rentedVehicles = [];
  if (rentingIds.length > 0) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, make, model, plate')
      .in('id', rentingIds)
      .eq('ride_ready_status', 'approved');
    if (error) {
      console.error('[IncomingGigOfferOverlay] fetchDriversRideReadyVehicles rented vehicles query failed:', error);
      return ownedUsable;
    }
    rentedVehicles = data || [];
  }

  return [...ownedUsable, ...rentedVehicles];
}

// Exported so the push-notification offer screen (GigOffer.jsx) can show the
// same card, with the same vehicle picker and accept logic.
export function OfferCard({ offer, driverId, onDismiss }) {
  const navigate = useNavigate();
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
        toast.error('No Ride-Ready vehicle available — to accept rides you need a Ride-Ready vehicle that you own (and isn\'t rented out) or are currently renting.');
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
      const { data: acceptedGig, error } = await supabase.rpc('accept_gig_request', {
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
      notify(acceptedGig?.customer_id, 'gig_accepted', 'Driver found', 'A driver accepted your gig and is on the way.', { gig_id: offer.gig_id });
      navigate(`/gig-drive/${offer.gig_id}`);
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
        {(Number(offer.distance_meters || 0) / 1000).toFixed(1)} km away
        {offer.fare_amount != null && ` · Fare R ${Number(offer.fare_amount).toFixed(2)}`}
      </p>
      {offer.payment_method === 'cash' ? (
        <p className="text-xs font-medium mb-3 rounded-lg bg-amber-50 text-amber-900 px-2 py-1.5">
          Cash gig — collect R {Number(offer.fare_amount || 0).toFixed(2)} from the customer. The commission is taken from your earnings balance.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">Paid by card in the app.</p>
      )}

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
