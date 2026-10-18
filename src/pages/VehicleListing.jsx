// src/pages/VehicleListing.jsx
//
// Route: /vehicle-listing/:vehicleId — where an owner finishes and keeps a
// vehicle listed (migration 021).
//
//   Rental (purpose rental / both): the listing is a draft until the listing
//     fee is paid through PayFast (listing-checkout) — or the owner's first
//     listing ever, which is free (start_free_listing). Each payment covers
//     app_settings.listing_period_months; paying before the end extends it.
//     In the Android app the fee is paid with Google Play Billing instead
//     (migration 022, lib/playBilling) — Play requires it for this purchase
//     and forbids pointing elsewhere; Google sets the in-app price.
//   Gigs (purpose gigs / both): the roadworthy certificate, reviewed by
//     Skootlink (VehicleRideReadySubmit).
//   A new vehicle that completes neither within 7 days is removed.
//   The owner can change what the vehicle is for (set_listing_purpose).

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/api/supabaseData';
import { fnUrl } from '@/lib/functionsUrl';
import { openPayfastCheckout } from '@/lib/payfastCheckout';
import { playBillingAvailable, getListingProduct, buyListingPeriod, finishUnfinishedPurchases } from '@/lib/playBilling';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { Loader2, KeyRound, Car, CheckCircle2, Clock, AlertTriangle, CreditCard, Gift, Pencil } from 'lucide-react';
import { toast } from 'sonner';

const longDate = (d) => new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
const PURPOSES = [
  { key: 'rental', label: 'Rent it to drivers' },
  { key: 'gigs', label: 'Use it for gigs (rides)' },
  { key: 'both', label: 'Both' },
];

export default function VehicleListing() {
  const { vehicleId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [vehicle, setVehicle] = useState(null);
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // 'free' | 'pay' | 'purpose'
  const [waitingForPayment, setWaitingForPayment] = useState(false);
  const isNative = Capacitor.isNativePlatform();
  const usePlay = playBillingAvailable();
  const [playProduct, setPlayProduct] = useState(undefined); // undefined = loading, null = unavailable

  const load = useCallback(async () => {
    const [{ data: v, error: vErr }, { data: o, error: oErr }] = await Promise.all([
      supabase.from('vehicles')
        .select('id, owner_id, make, model, year, plate, images, listing_purpose, listing_state, listed_at, expires_at, draft_expires_at, ride_ready_status, roadworthy_expiry_date, ride_ready_rejection_reason, renewal_status')
        .eq('id', vehicleId).maybeSingle(),
      supabase.rpc('listing_offer'),
    ]);
    if (vErr) console.error('[VehicleListing] vehicle load failed:', vErr);
    if (oErr) console.error('[VehicleListing] listing_offer failed:', oErr);
    setVehicle(v || null);
    setOffer((o || [])[0] || null);
    setLoading(false);
    return v || null;
  }, [vehicleId]);

  useEffect(() => { load(); }, [load]);

  // Android: the Google Play price, and any paid-but-unfinished listing purchase
  useEffect(() => {
    if (!usePlay) return;
    let alive = true;
    getListingProduct().then((p) => { if (alive) setPlayProduct(p); });
    finishUnfinishedPurchases().then((done) => {
      if (alive && done.some((d) => d.status === 'activated')) { toast.success('Payment received — your vehicle is listed'); load(); }
    });
    return () => { alive = false; };
  }, [usePlay, load]);

  // Back from PayFast: wait for the ITN to activate the listing
  useEffect(() => {
    const result = searchParams.get('payment');
    if (!result) return;
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('payment'); return n; }, { replace: true });
    if (result === 'cancelled') { toast('Payment cancelled — nothing was charged'); return; }
    setWaitingForPayment(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!waitingForPayment) return undefined;
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      const v = await load();
      if ((v && v.listing_state === 'active' && v.draft_expires_at == null && new Date(v.expires_at) > new Date()) || tries >= 20) {
        clearInterval(t);
        setWaitingForPayment(false);
        if (v?.listing_state === 'active') toast.success('Payment received — your vehicle is listed');
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waitingForPayment, load]);

  const useFreeListing = async () => {
    setBusy('free');
    const { error } = await supabase.rpc('start_free_listing', { p_vehicle_id: Number(vehicleId) });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Listed — your vehicle is now visible to drivers');
    load();
  };

  const payListingFee = async () => {
    setBusy('pay');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(fnUrl('listing-checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ vehicle_id: Number(vehicleId) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.payment) throw new Error(data.error || 'Payment could not be started');
      await openPayfastCheckout(data.payment);
    } catch (err) {
      console.error('[VehicleListing] pay failed:', err);
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const payWithGooglePlay = async () => {
    setBusy('pay');
    try {
      const out = await buyListingPeriod(Number(vehicleId));
      if (out.status === 'activated' || out.status === 'already_done') {
        toast.success('Payment received — your vehicle is listed');
        await load();
      } else if (out.status === 'pending') {
        toast('Your payment is pending in Google Play. The listing starts as soon as it goes through.');
      } else if (out.status === 'refund_due') {
        toast.error('Payment received, but this vehicle can no longer be listed for rental. Skootlink will refund you.');
        await load();
      }
    } catch (err) {
      console.error('[VehicleListing] Google Play payment failed:', err);
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const changePurpose = async (p) => {
    if (p === vehicle.listing_purpose) return;
    if (p === 'gigs' && vehicle.listing_state === 'active'
        && !window.confirm('Remove this vehicle from the rental marketplace? The time left on its listing is not refunded.')) return;
    setBusy('purpose');
    const { error } = await supabase.rpc('set_listing_purpose', { p_vehicle_id: Number(vehicleId), p_purpose: p });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Updated');
    load();
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!vehicle) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title="Vehicle listing" backTo="/briefcase" />
        <p className="text-muted-foreground">This vehicle wasn't found. It may have been removed.</p>
      </div>
    );
  }

  const forRental = ['rental', 'both'].includes(vehicle.listing_purpose);
  const forGigs = ['gigs', 'both'].includes(vehicle.listing_purpose);
  const active = vehicle.listing_state === 'active' && vehicle.expires_at && new Date(vehicle.expires_at) > new Date();
  const daysLeft = active ? Math.ceil((new Date(vehicle.expires_at) - Date.now()) / 86400000) : 0;
  const fee = offer ? Number(offer.fee) : null;
  const months = offer?.period_months ?? 6;
  const rr = vehicle.ride_ready_status;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-4">
      <PageHeader
        title={`${vehicle.make} ${vehicle.model}`}
        subtitle={vehicle.plate || 'Vehicle listing'}
        backTo="/briefcase"
      />

      {vehicle.draft_expires_at && (
        <Card className="p-4 border border-amber-200 bg-amber-50 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            This vehicle isn't listed yet. Finish {forRental && forGigs ? 'either step' : 'the step'} below by{' '}
            <span className="font-semibold">{longDate(vehicle.draft_expires_at)}</span>, or it will be removed with its photos.
          </p>
        </Card>
      )}

      <Card className="p-4 border border-border/50">
        <p className="text-sm font-semibold mb-2">What is it for?</p>
        <div className="flex flex-wrap gap-2">
          {PURPOSES.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={vehicle.listing_purpose === p.key ? 'default' : 'outline'}
              disabled={busy === 'purpose'}
              onClick={() => changePurpose(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Card>

      {forRental && (
        <Card className="p-5 border border-border/50 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            <p className="font-semibold">Rental listing</p>
          </div>

          {waitingForPayment ? (
            <p className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Confirming your payment…</p>
          ) : active ? (
            <p className="text-sm flex items-start gap-2 text-green-800">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              Listed until {longDate(vehicle.expires_at)}{daysLeft <= 7 ? ` — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {vehicle.listing_state === 'expired'
                ? 'This listing has ended and is hidden from drivers. Relist it to show it again.'
                : 'Not listed yet — drivers can\'t see this vehicle.'}
            </p>
          )}

          {!waitingForPayment && offer?.free_available && !active && (
            <Button className="w-full gap-2" onClick={useFreeListing} disabled={!!busy}>
              {busy === 'free' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
              List free for {months} months (your first listing)
            </Button>
          )}

          {!waitingForPayment && !(offer?.free_available && !active) && (
            usePlay ? (
              playProduct === undefined ? (
                <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading price…</p>
              ) : playProduct === null ? (
                <p className="text-xs text-muted-foreground">Paid listings aren't available on this device right now. Check that you are signed in to the Play Store.</p>
              ) : (
                <>
                  <Button className="w-full gap-2" variant={active ? 'outline' : 'default'} onClick={payWithGooglePlay} disabled={!!busy}>
                    {busy === 'pay' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {active ? `Extend by ${months} months — ${playProduct.priceString}` : `${vehicle.listing_state === 'expired' ? 'Relist' : 'List'} for ${months} months — ${playProduct.priceString}`}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Includes the rental agreement with drivers. Paid through Google Play.
                    {active && ' Extending adds the time to the end of your current listing.'}
                  </p>
                </>
              )
            ) : isNative ? (
              <p className="text-xs text-muted-foreground">Paid listings aren't available in the app yet.</p>
            ) : (
              <>
                <Button className="w-full gap-2" variant={active ? 'outline' : 'default'} onClick={payListingFee} disabled={!!busy || fee == null}>
                  {busy === 'pay' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  {active ? `Extend by ${months} months — R${fee?.toFixed(2)}` : `${vehicle.listing_state === 'expired' ? 'Relist' : 'List'} for ${months} months — R${fee?.toFixed(2)}`}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Includes the rental agreement with drivers. Secure payment through PayFast.
                  {active && ' Extending adds the time to the end of your current listing.'}
                </p>
              </>
            )
          )}
        </Card>
      )}

      {forGigs && (
        <Card className="p-5 border border-border/50 space-y-3">
          <div className="flex items-center gap-2">
            <Car className="w-5 h-5 text-primary" />
            <p className="font-semibold">Gigs (Ride-Ready)</p>
          </div>
          {rr === 'approved' && (
            <p className="text-sm flex items-start gap-2 text-green-800">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              Ride-Ready{vehicle.roadworthy_expiry_date ? ` until ${longDate(vehicle.roadworthy_expiry_date)}` : ''}.
              {vehicle.renewal_status === 'pending' && ' A new certificate is under review.'}
            </p>
          )}
          {rr === 'pending' && (
            <p className="text-sm flex items-start gap-2 text-amber-800">
              <Clock className="w-4 h-4 shrink-0 mt-0.5" /> Roadworthy certificate under review.
            </p>
          )}
          {rr === 'rejected' && (
            <p className="text-sm text-red-700">
              The roadworthy certificate wasn't approved{vehicle.ride_ready_rejection_reason ? `: ${vehicle.ride_ready_rejection_reason}` : '.'}
            </p>
          )}
          {rr === 'expired' && <p className="text-sm text-red-700">The roadworthy certificate has expired.</p>}
          {rr === 'not_submitted' && (
            <p className="text-sm text-muted-foreground">Upload the vehicle's roadworthy certificate. Skootlink checks it before the vehicle can be used for rides.</p>
          )}
          {rr !== 'pending' && (
            <Button asChild className="w-full" variant={rr === 'approved' ? 'outline' : 'default'}>
              <Link to={`/vehicle-ride-ready/${vehicle.id}`}>
                {rr === 'approved' ? 'Upload a renewed certificate' : 'Submit roadworthy certificate'}
              </Link>
            </Button>
          )}
        </Card>
      )}

      <Button variant="ghost" className="w-full gap-2" onClick={() => navigate(`/edit-vehicle?id=${vehicle.id}`)}>
        <Pencil className="w-4 h-4" /> Edit vehicle details
      </Button>
    </div>
  );
}
