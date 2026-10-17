// src/pages/DriverActiveGig.jsx
//
// The driver's screen for a gig they accepted. Route: /gig-drive/:gigId
//
// Steps: accepted -> "I've arrived" -> "Start trip" (in_progress, migration
// 009) -> "End trip" (customer then confirms or reports an issue; auto-
// confirms after 24h; migration 010). The driver can cancel until the trip
// starts. A completed gig shows the payout and a rating card.
//
// Keeps itself current with Realtime postgres_changes on the gig row plus a
// 5s poll, same as GigStatus.jsx, so a customer cancellation shows up here.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, fetchProfilesByIds } from '@/api/supabaseData';
import { notify } from '@/lib/notify';
import { parsePoint, directionsUrl } from '@/lib/geoPoint';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2, Car, Package, MapPin, Navigation, Phone, User, CheckCircle2, XCircle, Flag,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import GigRatingCard from '@/components/gigs/GigRatingCard';
import { toast } from 'sonner';

const formatRand = (n) => (n == null ? null : `R ${Number(n).toFixed(2)}`);

export default function DriverActiveGig() {
  const { gigId } = useParams();
  const navigate = useNavigate();
  const [gig, setGig] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // 'arrived' | 'start' | 'end' | 'cancel' | null
  const loadedRef = useRef({ customerId: null, vehicleId: null });
  const lastStatusRef = useRef(null);
  const announcedRef = useRef(false); // first load shouldn't toast

  const loadParties = useCallback(async (row) => {
    if (row.customer_id && loadedRef.current.customerId !== row.customer_id) {
      loadedRef.current.customerId = row.customer_id;
      try {
        const [profile] = await fetchProfilesByIds([row.customer_id]);
        setCustomer(profile || null);
      } catch (err) {
        console.error('[DriverActiveGig] customer profile fetch failed:', err);
        loadedRef.current.customerId = null;
      }
    }
    if (row.vehicle_id && loadedRef.current.vehicleId !== row.vehicle_id) {
      loadedRef.current.vehicleId = row.vehicle_id;
      const { data, error } = await supabase
        .from('vehicles').select('id, make, model, plate').eq('id', row.vehicle_id).maybeSingle();
      if (error) {
        console.error('[DriverActiveGig] vehicle fetch failed:', error);
        loadedRef.current.vehicleId = null;
      }
      setVehicle(data || null);
    }
  }, []);

  const applyGig = useCallback((row) => {
    const prev = lastStatusRef.current;
    if (announcedRef.current && prev !== row.status) {
      if (row.status === 'cancelled' && row.cancelled_by === row.customer_id) {
        toast.error('The customer cancelled this gig');
      } else if (row.status === 'completed') {
        toast.success('Gig completed');
      } else if (row.status === 'disputed') {
        toast.error('The customer reported an issue with this gig');
      }
    }
    announcedRef.current = true;
    lastStatusRef.current = row.status;
    setGig(row);
    loadParties(row);
  }, [loadParties]);

  const fetchGig = useCallback(async () => {
    const { data, error } = await supabase
      .from('gig_requests').select('*').eq('id', gigId).maybeSingle();
    setLoading(false);
    if (error) {
      console.error('[DriverActiveGig] fetch failed:', error);
      return;
    }
    if (data) applyGig(data);
  }, [gigId, applyGig]);

  useEffect(() => {
    fetchGig();
    const channel = supabase
      .channel(`gig-drive-${gigId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'gig_requests', filter: `id=eq.${gigId}` },
        (payload) => applyGig(payload.new),
      )
      .subscribe();
    const poll = setInterval(fetchGig, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigId]);

  // Runs one of the trip-step RPCs, then tells the customer.
  const runStep = async (step, rpc, args, notice) => {
    setBusy(step);
    try {
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) {
        console.error(`[DriverActiveGig] ${rpc} failed:`, error);
        toast.error(error.message || 'Something went wrong');
        fetchGig();
        return;
      }
      if (data) applyGig(data);
      if (notice) notify(gig.customer_id, notice.type, notice.title, notice.body, { gig_id: gig.id });
    } catch (err) {
      console.error(`[DriverActiveGig] ${rpc} error:`, err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleArrived = () => runStep('arrived', 'gig_driver_arrived', { p_gig_id: gig.id }, {
    type: 'gig_driver_arrived', title: 'Your driver has arrived', body: 'Your driver is at the pickup point.',
  });

  const handleStart = () => runStep('start', 'gig_start_trip', { p_gig_id: gig.id }, {
    type: 'gig_started', title: 'Your trip has started',
    body: gig.gig_type === 'ride' ? 'Enjoy your ride.' : 'Your delivery is on its way.',
  });

  const handleEndTrip = () => {
    if (!window.confirm('End this trip? The customer will be asked to confirm.')) return;
    runStep('end', 'gig_end_trip', { p_gig_id: gig.id }, {
      type: 'gig_ended', title: 'Please confirm your gig',
      body: 'Your driver ended the trip. Confirm it is complete, or report an issue.',
    });
  };

  const handleCancel = () => {
    // window.confirm is the pattern used elsewhere (proven in the Android app).
    if (!window.confirm('Cancel this gig? The customer will be told and can request again.')) return;
    runStep('cancel', 'cancel_gig_request', { p_gig_id: gig.id, p_reason: null }, {
      type: 'gig_cancelled', title: 'Your driver cancelled',
      body: 'Sorry — your driver cancelled. You can request a new gig.',
    });
  };

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
        <PageHeader title="Gig" backTo="/gigs" />
        <p className="text-muted-foreground">Gig not found.</p>
      </div>
    );
  }

  const isRide = gig.gig_type === 'ride';
  const arrived = !!gig.driver_arrived_at;
  const pickupPoint = parsePoint(gig.pickup_geo_location);
  const dropoffPoint = parsePoint(gig.dropoff_geo_location);
  const headingToPickup = gig.status === 'accepted';
  const navUrl = headingToPickup
    ? directionsUrl(pickupPoint, gig.pickup_address)
    : directionsUrl(dropoffPoint, gig.dropoff_address);

  let title = 'Gig';
  if (gig.status === 'accepted') title = arrived ? 'Waiting at pickup' : 'Head to pickup';
  else if (gig.status === 'in_progress') {
    title = gig.driver_completed_at
      ? 'Waiting for the customer to confirm'
      : (isRide ? 'Ride in progress' : 'Delivery in progress');
  }
  else if (gig.status === 'cancelled') title = 'Cancelled';
  else if (gig.status === 'completed') title = 'Completed';
  else if (gig.status === 'disputed') title = 'Under review';
  const awaitingConfirm = gig.status === 'in_progress' && !!gig.driver_completed_at;

  const contactPhone = !isRide && gig.status === 'in_progress' && gig.recipient_phone
    ? gig.recipient_phone
    : customer?.phone;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-4">
      <PageHeader title={isRide ? 'Ride' : 'Delivery'} backTo="/gigs" />

      <Card className="p-5 border border-border/50 space-y-4">
        <div className="flex items-center gap-3">
          {gig.status === 'cancelled'
            ? <XCircle className="w-6 h-6 text-destructive" />
            : gig.status === 'completed'
              ? <CheckCircle2 className="w-6 h-6 text-green-600" />
              : isRide ? <Car className="w-6 h-6 text-primary" /> : <Package className="w-6 h-6 text-primary" />}
          <div className="flex-1">
            <h3 className="font-semibold">{title}</h3>
            {gig.fare_amount != null && (
              <p className="text-sm text-muted-foreground">Estimated fare {formatRand(gig.fare_amount)}</p>
            )}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className={`flex items-start gap-2 ${headingToPickup ? '' : 'opacity-60'}`}>
            <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Pickup</p>
              <p>{gig.pickup_address}</p>
            </div>
          </div>
          <div className={`flex items-start gap-2 ${gig.status === 'in_progress' ? '' : 'opacity-60'}`}>
            <Flag className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Drop-off</p>
              <p>{gig.dropoff_address}</p>
            </div>
          </div>
        </div>

        {/* Customer (and, for deliveries, the recipient) */}
        <div className="bg-muted rounded-xl p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{customer?.full_name || 'Customer'}</span>
          </div>
          {!isRide && (gig.recipient_name || gig.recipient_phone) && (
            <p className="text-muted-foreground">
              Deliver to: {gig.recipient_name || 'Recipient'}{gig.recipient_phone ? ` · ${gig.recipient_phone}` : ''}
            </p>
          )}
          {!isRide && gig.delivery_notes && (
            <p className="text-muted-foreground">Notes: {gig.delivery_notes}</p>
          )}
          {isRide && vehicle && (
            <p className="text-muted-foreground">Your vehicle: {vehicle.make} {vehicle.model} ({vehicle.plate})</p>
          )}
        </div>

        {gig.status === 'cancelled' && (
          <p className="text-sm text-muted-foreground">
            {gig.cancelled_by === gig.customer_id ? 'The customer cancelled this gig.' : 'You cancelled this gig.'}
            {gig.cancellation_reason ? ` Reason: ${gig.cancellation_reason}` : ''}
          </p>
        )}

        {/* Actions */}
        {(gig.status === 'accepted' || gig.status === 'in_progress') && (
          <div className="space-y-2">
            <div className="flex gap-2">
              {navUrl && !awaitingConfirm && (
                <Button asChild variant="outline" className="flex-1">
                  <a href={navUrl} target="_blank" rel="noopener noreferrer">
                    <Navigation className="w-4 h-4 mr-2" />
                    {headingToPickup ? 'Navigate to pickup' : 'Navigate to drop-off'}
                  </a>
                </Button>
              )}
              {contactPhone && (
                <Button asChild variant="outline">
                  <a href={`tel:${contactPhone}`} aria-label="Call">
                    <Phone className="w-4 h-4" />
                  </a>
                </Button>
              )}
            </div>

            {gig.status === 'accepted' && !arrived && (
              <Button className="w-full" onClick={handleArrived} disabled={!!busy}>
                {busy === 'arrived' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                I've arrived
              </Button>
            )}
            {gig.status === 'accepted' && arrived && (
              <Button className="w-full" onClick={handleStart} disabled={!!busy}>
                {busy === 'start' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Start trip
              </Button>
            )}
            {gig.status === 'in_progress' && !awaitingConfirm && (
              <Button className="w-full" onClick={handleEndTrip} disabled={!!busy}>
                {busy === 'end' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                End trip
              </Button>
            )}
            {awaitingConfirm && (
              <p className="text-xs text-center text-muted-foreground">
                Trip ended. The customer has 24 hours to confirm; after that it confirms automatically.
              </p>
            )}
            {gig.status === 'accepted' && (
              <Button variant="ghost" className="w-full text-destructive" onClick={handleCancel} disabled={!!busy}>
                {busy === 'cancel' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Cancel gig
              </Button>
            )}
          </div>
        )}

        {gig.status === 'completed' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-muted p-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Fare</span><span>{formatRand(gig.fare_amount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Skootlink commission</span><span>− {formatRand(gig.commission_amount)}</span></div>
              <div className="flex justify-between font-semibold"><span>Your earnings</span><span>{formatRand(gig.driver_payout_amount)}</span></div>
              <p className="text-xs text-muted-foreground pt-1">
                Recorded as pending. Withdrawals open once in-app payments go live.
              </p>
            </div>
            <GigRatingCard gigId={gig.id} targetLabel="customer" />
          </div>
        )}

        {gig.status === 'disputed' && (
          <p className="text-sm text-muted-foreground">
            The customer reported an issue with this gig. Our team will review it and contact you.
          </p>
        )}

        {(gig.status === 'cancelled' || gig.status === 'completed' || gig.status === 'disputed') && (
          <Button variant="outline" className="w-full" onClick={() => navigate('/gigs')}>
            Back to Gigs
          </Button>
        )}
      </Card>
    </div>
  );
}
