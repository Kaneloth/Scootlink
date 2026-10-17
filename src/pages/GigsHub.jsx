// src/pages/GigsHub.jsx
//
// Hub for everything Gigs-related. Gives the three existing pages
// (/request-gig, /gig-verification, /vehicle-ride-ready/:id) their first
// entry points, and hosts the driver's "Available for Gigs" toggle.
// Reach it at /gigs. Placeholder for the planned "Gigs" bottom-nav tab —
// nothing in the navigation links here yet.
//
// Role handling follows the design: requesting a gig is open to EVERYONE;
// driver tools only for driver/both; vehicle tools only for owner/both.

import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import {
  subscribe, getSnapshot, startAvailability, stopAvailability, resumeIfWasAvailable,
} from '@/lib/driverAvailability';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Rocket, Car, Package, ShieldCheck, Clock, XCircle, Loader2, Power, AlertTriangle, ChevronRight, Wallet,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

const RIDE_READY_LABEL = {
  not_submitted: { text: 'Not submitted', cls: 'bg-muted text-muted-foreground' },
  pending: { text: 'Under review', cls: 'bg-amber-100 text-amber-700' },
  approved: { text: 'Ride-Ready', cls: 'bg-green-100 text-green-700' },
  rejected: { text: 'Rejected — resubmit', cls: 'bg-red-100 text-red-700' },
};

export default function GigsHub() {
  const navigate = useNavigate();
  const availability = useSyncExternalStore(subscribe, getSnapshot);

  const [user, setUser] = useState(null);
  const [verification, setVerification] = useState(null); // { tier, status } | null
  const [vehicles, setVehicles] = useState([]);
  const [openGigs, setOpenGigs] = useState([]); // gigs I'm in that aren't finished
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const me = await auth.me();
      setUser(me);
      if (!me?.id) { setLoading(false); return; }

      const isDriver = ['driver', 'both'].includes(me.account_type);
      const isOwner = ['owner', 'both'].includes(me.account_type);

      // Any unfinished gig I'm part of, as customer or as driver
      {
        const { data, error } = await supabase
          .from('gig_requests')
          .select('id, gig_type, status, customer_id, driver_id, pickup_address, driver_arrived_at, driver_completed_at')
          .or(`customer_id.eq.${me.id},driver_id.eq.${me.id}`)
          .in('status', ['pending', 'accepted', 'in_progress'])
          .order('created_at', { ascending: false });
        if (error) console.error('[GigsHub] open gigs fetch failed:', error);
        setOpenGigs(data || []);
      }

      if (isDriver) {
        const { data, error } = await supabase
          .from('driver_gig_verification')
          .select('tier, status')
          .eq('driver_id', me.id)
          .maybeSingle();
        if (error) console.error('[GigsHub] verification fetch failed:', error);
        setVerification(data || null);
        if (data?.status === 'approved') resumeIfWasAvailable(me.id);
      }

      if (isOwner) {
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, make, model, plate, ride_ready_status')
          .eq('owner_id', me.id);
        if (error) console.error('[GigsHub] vehicles fetch failed:', error);
        setVehicles(data || []);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isDriver = ['driver', 'both'].includes(user?.account_type);
  const isOwner = ['owner', 'both'].includes(user?.account_type);
  const approved = verification?.status === 'approved';
  const tierLabel = verification?.tier === 'passenger_ready' ? 'Passenger-Ready' : 'Delivery-Ready';
  const online = availability.status === 'on';
  const starting = availability.status === 'starting';

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-4">
      <PageHeader title="Gigs" subtitle="Rides and deliveries" backTo="/home" />

      {/* Unfinished gigs: get back to the trip screen */}
      {openGigs.map((g) => {
        const asDriver = g.driver_id === user?.id;
        let label = 'Finding a driver';
        if (g.status === 'accepted') {
          label = asDriver
            ? (g.driver_arrived_at ? 'Waiting at pickup' : 'Head to pickup')
            : (g.driver_arrived_at ? 'Your driver has arrived' : 'Driver on the way');
        } else if (g.status === 'in_progress') {
          label = g.driver_completed_at
            ? (asDriver ? 'Waiting for confirmation' : 'Please confirm your gig')
            : 'Trip in progress';
        }
        return (
          <Card key={g.id} className="p-4 border-2 border-primary/40 bg-primary/5">
            <button
              onClick={() => navigate(asDriver ? `/gig-drive/${g.id}` : `/gig-status/${g.id}`)}
              className="w-full flex items-center gap-3 text-left"
            >
              {g.gig_type === 'ride'
                ? <Car className="w-6 h-6 text-primary shrink-0" />
                : <Package className="w-6 h-6 text-primary shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">
                  {asDriver ? 'Your current gig' : 'Your current request'} · {label}
                </p>
                <p className="text-xs text-muted-foreground truncate">{g.pickup_address}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </Card>
        );
      })}

      {/* Everyone can request a gig */}
      <Card className="p-4 border border-border/50">
        <button onClick={() => navigate('/request-gig')} className="w-full flex items-center gap-3 text-left">
          <Rocket className="w-6 h-6 text-primary shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm">Request a Gig</p>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Car className="w-3 h-3" /> Ride <Package className="w-3 h-3" /> Delivery
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </Card>

      {isDriver && (
        <Card className="p-4 border border-border/50 space-y-3">
          <p className="font-semibold text-sm">Driver</p>

          {!verification && (
            <button onClick={() => navigate('/gig-verification')} className="w-full flex items-center gap-3 text-left">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Get Gig-Ready — free</p>
                <p className="text-xs text-muted-foreground">Verify your documents to start accepting gigs</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          )}

          {verification?.status === 'pending' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm border border-amber-200">
              <Clock className="w-4 h-4 shrink-0" /> Your Gig-Ready submission is under review.
            </div>
          )}

          {verification?.status === 'rejected' && (
            <button onClick={() => navigate('/gig-verification')} className="w-full flex items-center gap-3 text-left p-3 rounded-lg bg-red-50 border border-red-200">
              <XCircle className="w-4 h-4 text-red-600 shrink-0" />
              <p className="flex-1 text-sm text-red-800">Verification wasn't approved — tap to resubmit</p>
              <ChevronRight className="w-4 h-4 text-red-600" />
            </button>
          )}

          {approved && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-green-600" /> {tierLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {online ? 'Online — you can receive gig offers' : 'Offline — you won\'t receive offers'}
                  </p>
                </div>
                <Button
                  onClick={() => (online ? stopAvailability() : startAvailability())}
                  disabled={starting}
                  variant={online ? 'outline' : 'default'}
                  className="gap-2"
                >
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                  {starting ? 'Locating…' : online ? 'Go offline' : 'Go online'}
                </Button>
              </div>

              {availability.error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {availability.error}
                </div>
              )}
              {online && (
                <p className="text-[11px] text-muted-foreground">
                  Keep Skootlink open on screen while you're online — location updates pause if the app goes to the background.
                </p>
              )}

              <button
                onClick={() => navigate('/earnings')}
                className="w-full flex items-center gap-3 text-left pt-3 border-t border-border/50"
              >
                <Wallet className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Earnings</p>
                  <p className="text-xs text-muted-foreground">Your completed gigs, fees and payouts</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            </>
          )}
        </Card>
      )}

      {isOwner && (
        <Card className="p-4 border border-border/50 space-y-2">
          <p className="font-semibold text-sm">Your vehicles — Ride-Ready certification</p>
          <p className="text-xs text-muted-foreground">Only needed for vehicles used to carry passengers. Delivery-only vehicles don't need it.</p>
          {vehicles.length === 0 && <p className="text-xs text-muted-foreground py-2">You haven't listed any vehicles yet.</p>}
          {vehicles.map((v) => {
            const badge = RIDE_READY_LABEL[v.ride_ready_status] || RIDE_READY_LABEL.not_submitted;
            return (
              <button
                key={v.id}
                onClick={() => navigate(`/vehicle-ride-ready/${v.id}`)}
                className="w-full flex items-center gap-3 text-left p-3 rounded-lg border border-border/50 hover:bg-accent transition-colors"
              >
                <Car className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{v.make} {v.model}</p>
                  <p className="text-xs text-muted-foreground">{v.plate}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${badge.cls}`}>{badge.text}</span>
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}
