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

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, fetchProfilesByIds } from '@/api/supabaseData';
import { notify } from '@/lib/notify';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import GigRatingCard from '@/components/gigs/GigRatingCard';
import GigChat from '@/components/gigs/GigChat';
import { Loader2, Car, Package, MapPin, Star, Phone, XCircle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';

const STATUS_COPY = {
  pending: { title: 'Finding a driver...', sub: 'Searching nearby drivers' },
  accepted: { title: 'Driver found!', sub: 'Your driver is on the way' },
  in_progress: { title: 'Gig in progress', sub: null },
  completed: { title: 'Completed', sub: 'Thanks for using Skootlink' },
  no_drivers_available: { title: 'No drivers available', sub: 'No one nearby right now' },
  cancelled: { title: 'Cancelled', sub: null },
  disputed: { title: 'Under review', sub: 'Our team is looking into this' },
};

const formatRand = (n) => (n == null ? null : `R ${Number(n).toFixed(2)}`);

export default function GigStatus() {
  const { gigId } = useParams();
  const navigate = useNavigate();
  const [gig, setGig] = useState(null);
  const [driverProfile, setDriverProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vehicle, setVehicle] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reporting, setReporting] = useState(false);
  const loadedVehicleIdRef = useRef(null);
  // Which driver's profile is loaded (or loading). A ref, not state, so the
  // 5s poll and the Realtime handler always see the current value.
  const loadedDriverIdRef = useRef(null);
  // Last status we saw, so the "driver accepted" toast fires once, whether
  // the poll or the Realtime event notices the change first.
  const lastStatusRef = useRef(null);

  // Other users' profiles are read through the get-profiles function
  // (fetchProfilesByIds); a direct profiles query is blocked by RLS.
  const loadDriverProfile = useCallback(async (driverId) => {
    if (!driverId || loadedDriverIdRef.current === driverId) return;
    loadedDriverIdRef.current = driverId;
    try {
      const [profile] = await fetchProfilesByIds([driverId]);
      if (!profile) console.error('[GigStatus] no profile returned for driver', driverId);
      setDriverProfile(profile || null);
    } catch (err) {
      console.error('[GigStatus] driver profile fetch failed:', err);
      loadedDriverIdRef.current = null; // allow a retry on the next poll
    }
  }, []);

  // The car, for rides (shown to the customer so they recognise it).
  const loadVehicle = useCallback(async (vehicleId) => {
    if (!vehicleId || loadedVehicleIdRef.current === vehicleId) return;
    loadedVehicleIdRef.current = vehicleId;
    const { data, error } = await supabase
      .from('vehicles').select('id, make, model, plate').eq('id', vehicleId).maybeSingle();
    if (error) {
      console.error('[GigStatus] vehicle fetch failed:', error);
      loadedVehicleIdRef.current = null;
      return;
    }
    setVehicle(data || null);
  }, []);

  const lastArrivedRef = useRef(null);
  const lastEndedRef = useRef(null);

  const applyGig = useCallback((row) => {
    const prevStatus = lastStatusRef.current;
    if (row.status === 'accepted' && prevStatus === 'pending') {
      toast.success('A driver accepted your gig!');
    }
    if (prevStatus && row.driver_arrived_at && !lastArrivedRef.current) {
      toast.success('Your driver has arrived');
    }
    if (row.status === 'cancelled' && prevStatus && prevStatus !== 'cancelled'
        && row.cancelled_by && row.cancelled_by !== row.customer_id) {
      toast.error(row.admin_resolution
        ? 'This gig was closed by Skootlink support.'
        : row.customer_no_show
          ? 'Your driver waited but you didn\'t arrive, so the gig was cancelled.'
          : 'Your driver cancelled. You can request again.');
    }
    if (prevStatus && row.driver_completed_at && !lastEndedRef.current && row.status === 'in_progress') {
      toast('Your driver ended the trip — please confirm');
    }
    lastEndedRef.current = row.driver_completed_at;
    lastStatusRef.current = row.status;
    lastArrivedRef.current = row.driver_arrived_at;
    setGig(row);
    loadDriverProfile(row.driver_id);
    loadVehicle(row.vehicle_id);
  }, [loadDriverProfile, loadVehicle]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const { data, error } = await supabase.rpc('confirm_gig_completion', { p_gig_id: gig.id });
      if (error) {
        console.error('[GigStatus] confirm_gig_completion failed:', error);
        toast.error(error.message || 'Could not confirm');
        fetchGig();
        return;
      }
      if (data) applyGig(data);
      notify(gig.driver_id, 'gig_completed', 'Gig completed', 'The customer confirmed your gig is complete.', { gig_id: gig.id });
      toast.success('Thanks! Gig completed.');
    } catch (err) {
      console.error('[GigStatus] confirm error:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  const handleReport = async () => {
    if (!reportText.trim()) {
      toast.error('Please describe the issue');
      return;
    }
    setReporting(true);
    try {
      const { data, error } = await supabase.rpc('report_gig_issue', { p_gig_id: gig.id, p_reason: reportText.trim() });
      if (error) {
        console.error('[GigStatus] report_gig_issue failed:', error);
        toast.error(error.message || 'Could not send your report');
        fetchGig();
        return;
      }
      if (data) applyGig(data);
      notify(gig.driver_id, 'gig_disputed', 'Issue reported', 'The customer reported an issue with your gig. Our team will review it.', { gig_id: gig.id });
      setReportOpen(false);
      toast.success('Report sent — our team will review it');
    } catch (err) {
      console.error('[GigStatus] report error:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setReporting(false);
    }
  };

  const handleCancel = async () => {
    // Ask the server what cancelling costs right now (migration 012), so the
    // customer sees the exact fee before confirming.
    let fee = 0;
    {
      const { data: quote, error: quoteErr } = await supabase.rpc('gig_cancellation_quote', { p_gig_id: gig.id });
      if (quoteErr) {
        console.error('[GigStatus] gig_cancellation_quote failed:', quoteErr);
        toast.error('Could not check the cancellation fee. Please try again.');
        return;
      }
      fee = Number(quote) || 0;
    }
    let message = 'Cancel this request?';
    if (fee > 0) {
      message = gig.driver_arrived_at
        ? `Your driver is already at the pickup point. Cancelling now incurs a ${formatRand(fee)} cancellation fee. Cancel anyway?`
        : `Your driver is on the way. Cancelling now incurs a ${formatRand(fee)} cancellation fee. Cancel anyway?`;
    }
    if (!window.confirm(message)) return;
    setCancelling(true);
    try {
      const { data, error } = await supabase.rpc('cancel_gig_request', { p_gig_id: gig.id, p_reason: null });
      if (error) {
        console.error('[GigStatus] cancel_gig_request failed:', error);
        toast.error(error.message || 'Could not cancel');
        fetchGig();
        return;
      }
      if (data) applyGig(data);
      if (gig.driver_id) {
        notify(gig.driver_id, 'gig_cancelled', 'Gig cancelled', 'The customer cancelled this gig.', { gig_id: gig.id });
      }
      toast(data?.cancellation_fee > 0
        ? `Request cancelled. Cancellation fee: ${formatRand(data.cancellation_fee)}`
        : 'Request cancelled');
    } catch (err) {
      console.error('[GigStatus] cancel error:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  const fetchGig = useCallback(async () => {
    const { data, error } = await supabase
      .from('gig_requests')
      .select('*')
      .eq('id', gigId)
      .single();
    setLoading(false);
    if (error) {
      console.error('[GigStatus] fetch failed:', error);
      return;
    }
    applyGig(data);
  }, [gigId, applyGig]);

  useEffect(() => {
    fetchGig();

    const channel = supabase
      .channel(`gig-status-${gigId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'gig_requests', filter: `id=eq.${gigId}` },
        (payload) => {
          // payload.old only carries the primary key unless the table has
          // REPLICA IDENTITY FULL, so compare against our previous state.
          applyGig(payload.new);
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

  const isRide = gig.gig_type === 'ride';
  let copy = STATUS_COPY[gig.status] || { title: gig.status, sub: null };
  if (gig.status === 'accepted' && gig.driver_arrived_at) {
    copy = { title: 'Your driver has arrived', sub: 'Meet them at the pickup point' };
  }
  const awaitingConfirm = gig.status === 'in_progress' && !!gig.driver_completed_at;
  if (gig.status === 'in_progress') {
    copy = awaitingConfirm
      ? { title: 'Your driver ended the trip', sub: 'Please confirm it is complete' }
      : { title: isRide ? 'On your way' : 'Delivery on its way', sub: null };
  }
  if (gig.status === 'cancelled') {
    let sub = gig.cancelled_by && gig.cancelled_by !== gig.customer_id ? 'Your driver cancelled' : 'You cancelled this request';
    if (gig.customer_no_show) sub = 'Your driver waited at the pickup point but you didn\'t arrive';
    if (gig.admin_resolution === 'admin_cancelled') sub = 'Cancelled by Skootlink support';
    if (gig.admin_resolution === 'voided') sub = 'Your report was upheld and the gig was voided';
    if (gig.cancellation_fee > 0) sub += ` · Cancellation fee ${formatRand(gig.cancellation_fee)}`;
    copy = { title: 'Cancelled', sub };
  }
  const showDriver = (gig.status === 'accepted' || gig.status === 'in_progress') && driverProfile;
  const canCancel = gig.status === 'pending' || gig.status === 'accepted';

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title={isRide ? 'Ride' : 'Delivery'} backTo="/home" />

      <Card className="p-6 border border-border/50">
        <div className="flex items-center gap-3 mb-4">
          {gig.status === 'pending' ? (
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          ) : gig.status === 'cancelled' ? (
            <XCircle className="w-6 h-6 text-destructive" />
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
            Estimated fare: <span className="font-bold">{formatRand(gig.fare_amount)}</span>
          </p>
        )}

        {showDriver && (
          <div className="bg-muted rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">{driverProfile.full_name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {driverProfile.rating > 0
                    ? <><Star className="w-3 h-3 fill-current" /> {Number(driverProfile.rating).toFixed(1)}</>
                    : 'New driver'}
                </p>
                {isRide && vehicle && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {vehicle.make} {vehicle.model} · <span className="font-mono">{vehicle.plate}</span>
                  </p>
                )}
              </div>
              {driverProfile.phone && (
                <Button asChild variant="outline" size="icon">
                  <a href={`tel:${driverProfile.phone}`} aria-label="Call driver">
                    <Phone className="w-4 h-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}

        {gig.driver_id && (
          <div className="mb-4">
            <GigChat
              gigId={gig.id}
              meId={gig.customer_id}
              otherLabel="your driver"
              canSend={gig.status === 'accepted' || gig.status === 'in_progress'}
            />
          </div>
        )}

        {awaitingConfirm && !reportOpen && (
          <div className="space-y-2 mb-2">
            <Button className="w-full" onClick={handleConfirm} disabled={confirming}>
              {confirming && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm complete
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setReportOpen(true)} disabled={confirming}>
              Report an issue
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              If you don't respond within 24 hours, the gig is confirmed automatically.
            </p>
          </div>
        )}

        {awaitingConfirm && reportOpen && (
          <div className="space-y-2 mb-2">
            <Textarea
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              placeholder="What went wrong?"
              rows={3}
              maxLength={1000}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setReportOpen(false)} disabled={reporting}>
                Back
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleReport} disabled={reporting}>
                {reporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Send report
              </Button>
            </div>
          </div>
        )}

        {gig.status === 'completed' && (
          <div className="space-y-3 mb-2">
            {gig.auto_confirmed && (
              <p className="text-xs text-muted-foreground">Confirmed automatically after 24 hours.</p>
            )}
            {gig.admin_resolution === 'released' && (
              <p className="text-xs text-muted-foreground">Your report was reviewed by Skootlink support and the gig was completed.</p>
            )}
            {gig.driver_id && <GigRatingCard gigId={gig.id} targetLabel="driver" />}
          </div>
        )}

        {(gig.status === 'no_drivers_available' || gig.status === 'cancelled') && (
          <Button onClick={() => navigate('/request-gig')} className="w-full">
            {gig.status === 'cancelled' ? 'Request again' : 'Try Again'}
          </Button>
        )}

        {canCancel && (
          <Button
            variant="ghost"
            className="w-full text-destructive mt-2"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Cancel request
          </Button>
        )}
      </Card>
    </div>
  );
}
