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
//
// Payment (migration 018): a new card gig starts as 'awaiting_payment'. This
// page shows the fare and a Pay button (gig-checkout -> PayFast). When
// PayFast's ITN confirms the payment the gig becomes 'pending' and the
// driver search starts; the poll / Realtime picks that up. After a paid gig
// is cancelled or finds no driver, the refund state is shown here.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, fetchProfilesByIds } from '@/api/supabaseData';
import { fnUrl } from '@/lib/functionsUrl';
import { openPayfastCheckout, PAYMENT_RESULT_EVENT } from '@/lib/payfastCheckout';
import { Capacitor } from '@capacitor/core';
import { notify } from '@/lib/notify';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import GigRatingCard from '@/components/gigs/GigRatingCard';
import GigChat from '@/components/gigs/GigChat';
import RefundBankDetails from '@/components/gigs/RefundBankDetails';
import { Loader2, Car, Package, MapPin, Star, Phone, XCircle, CreditCard, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';

const STATUS_COPY = {
  awaiting_payment: { title: 'Pay to find a driver', sub: 'We start searching as soon as your payment is confirmed' },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [paying, setPaying] = useState(false);
  // Pay was pressed but no driver was online nearby (customer not charged)
  const [noDriversNow, setNoDriversNow] = useState(false);
  // Set when the customer comes back from PayFast; cleared once the ITN has
  // moved the gig on (or after 2 minutes, in case the payment never arrives)
  const [confirmingPayment, setConfirmingPayment] = useState(false);
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
    let message = gig.status === 'awaiting_payment'
      ? 'Cancel this request? You have not been charged.'
      : gig.payment_status === 'paid' && fee <= 0
        ? 'Cancel this request? Your payment will be refunded in full.'
        : 'Cancel this request?';
    if (fee > 0) {
      message = gig.driver_arrived_at
        ? `Your driver is already at the pickup point. Cancelling now incurs a ${formatRand(fee)} cancellation fee. Cancel anyway?`
        : `Your driver is on the way. Cancelling now incurs a ${formatRand(fee)} cancellation fee. Cancel anyway?`;
      if (gig.payment_status === 'paid' && gig.fare_amount > fee) {
        message = message.replace(' Cancel anyway?', ` The rest of your fare (${formatRand(gig.fare_amount - fee)}) will be refunded. Cancel anyway?`);
      }
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

  const handlePay = async () => {
    setPaying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please sign in again');
      const res = await fetch(fnUrl('gig-checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ gig_id: gig.id, is_native: Capacitor.isNativePlatform() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.no_drivers) {
        setNoDriversNow(true);
        return;
      }
      setNoDriversNow(false);
      if (res.status === 409) {
        fetchGig();
        throw new Error(data.error || 'This request is no longer waiting for payment');
      }
      if (!res.ok || !data.payment) throw new Error(data.error || 'Payment could not be started');
      await openPayfastCheckout(data.payment);
    } catch (err) {
      console.error('[GigStatus] pay error:', err);
      toast.error(err.message || 'Payment could not be started. Please try again.');
    } finally {
      setPaying(false);
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

  // Back from PayFast — web: ?payment=success|cancelled; native: the
  // payment-result event from App.jsx's deep-link handler.
  useEffect(() => {
    const result = searchParams.get('payment');
    if (!result) return;
    if (result === 'success') setConfirmingPayment(true);
    if (result === 'cancelled') toast('Payment cancelled — you have not been charged');
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('payment'); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResult = (e) => {
      const d = e.detail || {};
      if (d.category !== 'gig' || String(d.gig_id) !== String(gigId)) return;
      try { sessionStorage.removeItem('skootlink_payment_result'); } catch { /* ignore */ }
      if (d.status === 'success') { setConfirmingPayment(true); fetchGig(); }
      else toast('Payment cancelled — you have not been charged');
    };
    window.addEventListener(PAYMENT_RESULT_EVENT, onResult);
    // The app may have been reopened by the deep link before this page mounted
    try {
      const stashed = JSON.parse(sessionStorage.getItem('skootlink_payment_result') || 'null');
      if (stashed) onResult({ detail: stashed });
    } catch { /* ignore */ }
    return () => window.removeEventListener(PAYMENT_RESULT_EVENT, onResult);
  }, [gigId, fetchGig]);

  useEffect(() => {
    if (!confirmingPayment) return undefined;
    if (gig && gig.status !== 'awaiting_payment') { setConfirmingPayment(false); return undefined; }
    const t = setTimeout(() => setConfirmingPayment(false), 120000);
    return () => clearTimeout(t);
  }, [confirmingPayment, gig]);

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
    if (gig.cancellation_reason === 'Payment not completed') sub = 'The payment was not completed, so the request was cancelled';
    if (gig.cancellation_fee > 0) sub += ` · Cancellation fee ${formatRand(gig.cancellation_fee)}`;
    copy = { title: 'Cancelled', sub };
  }
  if (gig.status === 'awaiting_payment' && confirmingPayment) {
    copy = { title: 'Confirming your payment…', sub: 'This usually takes a few seconds' };
  }
  const refundAmount = Math.max(0, Number(gig.fare_amount || 0) - Number(gig.cancellation_fee || 0));
  const refundNote = gig.payment_status === 'refund_due'
    ? `A refund of ${formatRand(refundAmount)} is on its way to you.`
    : gig.payment_status === 'refunded'
      ? `${formatRand(refundAmount)} has been refunded. Your bank may take a few days to show it.`
      : null;
  const showDriver = (gig.status === 'accepted' || gig.status === 'in_progress') && driverProfile;
  const canCancel = gig.status === 'awaiting_payment' || gig.status === 'pending' || gig.status === 'accepted';
  const payLabel = { paid: 'Paid', refund_due: 'Refund due', refunded: 'Refunded', kept: 'Paid' }[gig.payment_status];

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title={isRide ? 'Ride' : 'Delivery'} backTo="/home" />

      <Card className="p-6 border border-border/50">
        <div className="flex items-center gap-3 mb-4">
          {gig.status === 'pending' || (gig.status === 'awaiting_payment' && confirmingPayment) ? (
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
            Fare: <span className="font-bold">{formatRand(gig.fare_amount)}</span>
            {payLabel && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{payLabel}</span>}
          </p>
        )}

        {refundNote && (
          <p className="text-sm mb-4 rounded-lg bg-muted p-3">{refundNote}</p>
        )}
        {gig.payment_status === 'refund_due' && (
          <RefundBankDetails gigId={gig.id} meId={gig.customer_id} />
        )}

        {gig.status === 'awaiting_payment' && !confirmingPayment && (
          <div className="mb-4 space-y-2">
            {noDriversNow && (
              <p className="text-sm rounded-lg bg-amber-50 text-amber-900 p-3">
                No drivers are available near your pickup right now. You have not been charged — try again in a few minutes.
              </p>
            )}
            <Button className="w-full gap-2" onClick={handlePay} disabled={paying}>
              {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {noDriversNow ? `Try again · ${formatRand(gig.fare_amount)}` : `Pay ${formatRand(gig.fare_amount)}`}
            </Button>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
              Secure payment through PayFast. If no driver is found you get a full refund.
              Cancelling after a driver has been on the way for a while incurs a cancellation fee.
            </p>
          </div>
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
              otherId={gig.driver_id}
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
