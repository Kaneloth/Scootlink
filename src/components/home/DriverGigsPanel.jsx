// src/components/home/DriverGigsPanel.jsx
//
// The driver's gig controls at the top of Home: go online/offline, today's
// gigs and the balance, or — before verification — the way in.

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Power, Loader2, ShieldCheck, Clock, XCircle, Wallet, ChevronRight, AlertTriangle, Rocket } from 'lucide-react';
import { supabase } from '@/api/supabaseData';
import { subscribe, getSnapshot, startAvailability, stopAvailability, resumeIfWasAvailable } from '@/lib/driverAvailability';
import { Button } from '@/components/ui/button';
import { rand } from './gigLabels';

export default function DriverGigsPanel({ userId }) {
  const navigate = useNavigate();
  const availability = useSyncExternalStore(subscribe, getSnapshot);
  const [verification, setVerification] = useState(undefined); // undefined = loading
  const [balance, setBalance] = useState(null);
  const [today, setToday] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      const { data: v, error } = await supabase
        .from('driver_gig_verification')
        .select('tier, status')
        .eq('driver_id', userId)
        .maybeSingle();
      if (error) console.error('[DriverGigsPanel] verification failed:', error);
      if (!alive) return;
      setVerification(v || null);
      if (v?.status !== 'approved') return;
      resumeIfWasAvailable(userId);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [{ data: b }, { count }] = await Promise.all([
        supabase.rpc('my_gig_balance'),
        supabase.from('gig_requests').select('id', { count: 'exact', head: true })
          .eq('driver_id', userId).eq('status', 'completed').gte('created_at', start.toISOString()),
      ]);
      if (!alive) return;
      setBalance((b || [])[0] || null);
      setToday(count ?? 0);
    })();
    return () => { alive = false; };
  }, [userId]);

  if (verification === undefined) return <div className="h-28 rounded-2xl bg-muted animate-pulse mb-4" />;

  if (!verification || verification.status === 'rejected') {
    return (
      <button
        onClick={() => navigate('/gig-verification')}
        className="w-full flex items-center gap-3 p-4 mb-4 rounded-2xl border border-primary/30 bg-primary/5 text-left"
      >
        {verification ? <XCircle className="w-6 h-6 text-red-600 shrink-0" /> : <Rocket className="w-6 h-6 text-primary shrink-0" />}
        <span className="flex-1">
          <span className="block font-semibold text-sm">{verification ? 'Gig verification not approved' : 'Earn from rides and deliveries'}</span>
          <span className="block text-xs text-muted-foreground">
            {verification ? 'Tap to see why and resubmit' : 'Get Gig-Ready for free: verify your documents to start'}
          </span>
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>
    );
  }

  if (verification.status === 'pending') {
    return (
      <div className="flex items-center gap-3 p-4 mb-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900">
        <Clock className="w-5 h-5 shrink-0" />
        <p className="text-sm">Your Gig-Ready documents are under review. We'll let you know.</p>
      </div>
    );
  }

  const online = availability.status === 'on';
  const starting = availability.status === 'starting';
  const available = Number(balance?.available ?? 0);

  return (
    <div className={`rounded-2xl p-4 mb-4 shadow-sm border ${online ? 'bg-green-600 text-white border-green-700' : 'bg-card border-border'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-xs flex items-center gap-1 ${online ? 'text-white/80' : 'text-muted-foreground'}`}>
            <ShieldCheck className="w-3.5 h-3.5" /> {verification.tier === 'passenger_ready' ? 'Rides and deliveries' : 'Deliveries'}
          </p>
          <p className="text-lg font-bold">{online ? 'You\'re online' : 'You\'re offline'}</p>
          <p className={`text-xs ${online ? 'text-white/80' : 'text-muted-foreground'}`}>
            {online ? 'Gig offers will pop up here' : 'Go online to receive gig offers'}
          </p>
        </div>
        <Button
          onClick={() => (online ? stopAvailability() : startAvailability())}
          disabled={starting}
          variant={online ? 'secondary' : 'default'}
          className="gap-2 rounded-full px-5 h-11 shrink-0"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
          {starting ? 'Locating…' : online ? 'Go offline' : 'Go online'}
        </Button>
      </div>

      {availability.error && (
        <p className="mt-3 flex items-start gap-2 text-xs rounded-lg bg-destructive/10 text-destructive p-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {availability.error}
        </p>
      )}

      <button
        onClick={() => navigate('/earnings')}
        className={`mt-4 w-full grid grid-cols-3 gap-2 rounded-xl p-3 text-left ${online ? 'bg-white/15' : 'bg-muted'}`}
      >
        <Stat label="Gigs today" value={today ?? '—'} />
        <Stat label={available < 0 ? 'You owe' : 'Balance'} value={balance ? rand(Math.abs(available)) : '—'} />
        <span className="flex items-center justify-end gap-1 text-xs font-medium">
          <Wallet className="w-4 h-4" /> Earnings <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </button>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <span>
      <span className="block text-[11px] opacity-75">{label}</span>
      <span className="block font-semibold">{value}</span>
    </span>
  );
}
