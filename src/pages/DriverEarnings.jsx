// src/pages/DriverEarnings.jsx
//
// Route: /earnings — the driver's read-only earnings ledger (planning
// decision: no in-app wallet; money is never movable inside the app, only
// "Withdraw to bank").
//
// Data: gig_earnings_ledger (RLS: a driver sees only their own rows) joined
// in the app to the driver's gigs (RLS: the assigned driver can read them).
// Each ledger row is one completed gig, or one cancellation / no-show fee.
//   pending   = earned; becomes available when the customer's payment is in
//   available = can be withdrawn to bank
//   withdrawn = paid out

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Car, Package, XCircle, ChevronRight, Landmark } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

const formatRand = (n) => `R ${Number(n || 0).toFixed(2)}`;

const STATUS_LABEL = {
  pending: { text: 'Pending', cls: 'bg-amber-100 text-amber-700' },
  available: { text: 'Available', cls: 'bg-green-100 text-green-700' },
  withdrawn: { text: 'Withdrawn', cls: 'bg-muted text-muted-foreground' },
};

// Monday 00:00 of the current week, local time
function startOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

export default function DriverEarnings() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null); // [{ ledger, gig }]
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await auth.me();
        if (!me?.id) throw new Error('Not signed in');

        const { data: ledger, error: ledgerErr } = await supabase
          .from('gig_earnings_ledger')
          .select('id, gig_request_id, amount, status, created_at, available_at, withdrawn_at')
          .eq('driver_id', me.id)
          .order('created_at', { ascending: false })
          .limit(200);
        if (ledgerErr) throw ledgerErr;

        const gigIds = [...new Set((ledger || []).map((l) => l.gig_request_id))];
        let gigsById = {};
        if (gigIds.length > 0) {
          const { data: gigs, error: gigsErr } = await supabase
            .from('gig_requests')
            .select('id, gig_type, status, pickup_address, dropoff_address, fare_amount, cancellation_fee, customer_no_show, commission_amount, driver_payout_amount, completed_at, cancelled_at')
            .in('id', gigIds);
          if (gigsErr) throw gigsErr;
          gigsById = Object.fromEntries((gigs || []).map((g) => [g.id, g]));
        }

        if (alive) setRows((ledger || []).map((l) => ({ ledger: l, gig: gigsById[l.gig_request_id] || null })));
      } catch (err) {
        console.error('[DriverEarnings] load failed:', err);
        if (alive) {
          setError('Could not load your earnings. Please try again.');
          setRows([]);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  if (rows === null) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const weekStart = startOfWeek();
  const sum = (pred) => rows.filter(pred).reduce((t, r) => t + Number(r.ledger.amount || 0), 0);
  const thisWeek = sum((r) => new Date(r.ledger.created_at) >= weekStart);
  const pending = sum((r) => r.ledger.status === 'pending');
  const available = sum((r) => r.ledger.status === 'available');
  const weekCount = rows.filter((r) => new Date(r.ledger.created_at) >= weekStart).length;

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto space-y-4">
      <PageHeader title="Earnings" subtitle="Your gig earnings after commission" backTo="/gigs" />

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <Card className="p-5 border border-border/50">
        <p className="text-xs text-muted-foreground">This week</p>
        <p className="text-3xl font-bold mt-1">{formatRand(thisWeek)}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {weekCount} {weekCount === 1 ? 'earning' : 'earnings'} since Monday
        </p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="rounded-xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="font-semibold">{formatRand(pending)}</p>
          </div>
          <div className="rounded-xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">Available</p>
            <p className="font-semibold">{formatRand(available)}</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Pending earnings become available once the customer's payment has been received.
        </p>

        <Button className="w-full mt-4 gap-2" disabled={available <= 0}>
          <Landmark className="w-4 h-4" /> Withdraw to bank
        </Button>
        {available <= 0 && (
          <p className="text-[11px] text-center text-muted-foreground mt-2">Nothing available to withdraw.</p>
        )}
      </Card>

      <div className="space-y-2">
        <p className="text-sm font-semibold">History</p>
        {rows.length === 0 && !error && (
          <Card className="p-5 border border-border/50 text-sm text-muted-foreground">
            No earnings yet. Completed gigs will appear here.
          </Card>
        )}
        {rows.map(({ ledger, gig }) => {
          const isFee = gig?.status === 'cancelled';
          const gross = isFee ? gig?.cancellation_fee : gig?.fare_amount;
          const Icon = isFee ? XCircle : gig?.gig_type === 'delivery' ? Package : Car;
          const label = isFee
            ? (gig?.customer_no_show ? 'No-show fee' : 'Cancellation fee')
            : gig?.gig_type === 'delivery' ? 'Delivery' : 'Ride';
          const badge = STATUS_LABEL[ledger.status] || STATUS_LABEL.pending;
          return (
            <Card key={ledger.id} className="p-4 border border-border/50">
              <button
                onClick={() => gig && navigate(`/gig/${gig.id}`)}
                className="w-full flex items-start gap-3 text-left"
              >
                <Icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-sm font-semibold">{formatRand(ledger.amount)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{gig?.pickup_address || `Gig #${ledger.gig_request_id}`}</p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(ledger.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {gross != null && ` · ${formatRand(gross)} − ${formatRand(gig?.commission_amount)} commission`}
                    </p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
