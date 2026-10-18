// src/pages/admin/AdminPayments.jsx
//
// Admin: gig refunds and driver payouts. Route: /admin/payments.
// Everything goes through the admin-payments Netlify function (migration 018).
//
// Refunds: a paid card gig that is cancelled or finds no driver queues a
// refund of the fare minus any fee. "Refund now" asks PayFast how it can be
// refunded and sends it (live mode only — PayFast refunds don't work in
// sandbox). When PayFast will only pay it into a bank account, it waits for
// the customer to add their bank details on the gig screen, then shows as
// due again.
// "Mark refunded" records a refund done by hand in the PayFast dashboard.
// Automatic refunds (every minute, by gig-expiry-check) can be switched on
// once a live refund has been checked.
//
// Payouts: drivers request everything available; pay it by EFT from the
// business account, then mark it paid with the EFT reference.

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const rand = (n) => (n == null ? '—' : `R ${Number(n).toFixed(2)}`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const who = (p) => (p ? `${p.full_name || 'Unnamed'}${p.email ? ` · ${p.email}` : ''}` : '—');

const REFUND_CLS = {
  due: 'bg-amber-100 text-amber-700',
  needs_bank_details: 'bg-purple-100 text-purple-700',
  processing: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-green-100 text-green-700',
};
const PAYOUT_CLS = {
  pending: 'bg-amber-100 text-amber-700',
  processing: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  rejected: 'bg-muted text-muted-foreground',
};

async function callAdminPayments(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/admin-payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function RefundRow({ r, mode, onDone }) {
  const [busy, setBusy] = useState(null);
  const open = r.status !== 'refunded';

  const refundNow = async () => {
    if (!window.confirm(`Send a refund of ${rand(r.amount)} to ${r.customer?.full_name || 'the customer'} through PayFast now?`)) return;
    setBusy('send');
    try {
      const out = await callAdminPayments({ action: 'refund_now', refundId: r.id });
      if (out.ok) toast.success(out.method === 'BANK_PAYOUT' ? 'Refund sent to the customer\'s bank account ✓' : 'Refund sent ✓');
      else if (out.needsBankDetails) toast(out.message || 'Waiting for the customer\'s bank details');
      onDone();
    }
    catch (err) { toast.error(err.message); onDone(); }
    setBusy(null);
  };
  const markRefunded = async () => {
    const reference = window.prompt('PayFast refund reference (from the PayFast dashboard):');
    if (!reference) return;
    setBusy('mark');
    try { await callAdminPayments({ action: 'mark_refunded', refundId: r.id, reference }); toast.success('Marked refunded ✓'); onDone(); }
    catch (err) { toast.error(err.message); }
    setBusy(null);
  };

  return (
    <div className="rounded-xl border border-border p-4 bg-card space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">{rand(r.amount)} · Gig #{r.gig_id}</p>
          <p className="text-xs text-muted-foreground">{who(r.customer)}</p>
          <p className="text-xs text-muted-foreground">Queued {when(r.created_at)}{r.attempts ? ` · ${r.attempts} attempt(s)` : ''}</p>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${REFUND_CLS[r.status] || 'bg-muted'}`}>
          {r.status === 'needs_bank_details' ? 'waiting for bank details' : r.status}
        </span>
      </div>
      {(r.funding_type || r.refund_method) && (
        <p className="text-xs text-muted-foreground">
          {r.funding_type ? `Paid by ${r.funding_type}` : ''}{r.funding_type && r.refund_method ? ' · ' : ''}
          {r.refund_method === 'BANK_PAYOUT' ? 'refund goes to a bank account' : r.refund_method === 'PAYMENT_SOURCE' ? 'refund goes back to the card' : r.refund_method || ''}
        </p>
      )}
      {r.last_error && r.status !== 'refunded' && (
        <p className={`text-xs break-words ${r.status === 'needs_bank_details' ? 'text-purple-700' : 'text-red-700'}`}>{r.last_error}</p>
      )}
      {r.status === 'refunded' && (
        <p className="text-xs text-muted-foreground">Refunded {when(r.processed_at)}{r.provider_reference ? ` · ref ${r.provider_reference}` : ''}</p>
      )}
      {open && (
        <div className="flex gap-2">
          <Button size="sm" disabled={!!busy || mode !== 'live' || r.status === 'processing'} onClick={refundNow}
            title={mode !== 'live' ? "PayFast refunds don't work in sandbox mode" : undefined}>
            {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Refund now'}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={markRefunded}>
            {busy === 'mark' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mark refunded'}
          </Button>
        </div>
      )}
    </div>
  );
}

function PayoutRow({ p, onDone }) {
  const [busy, setBusy] = useState(null);
  const open = p.status === 'pending' || p.status === 'processing';

  const settle = async (outcome) => {
    let note = null;
    if (outcome === 'paid') {
      note = window.prompt(`EFT reference for the ${rand(p.amount)} payment to ${p.bank_account_holder}:`);
      if (!note) return;
    } else if (outcome === 'rejected') {
      note = window.prompt('Why is this payout not being sent? (the driver sees this)');
      if (!note) return;
    }
    setBusy(outcome);
    try { await callAdminPayments({ action: 'settle_payout', withdrawalId: p.id, outcome, note }); toast.success('Done ✓'); onDone(); }
    catch (err) { toast.error(err.message); }
    setBusy(null);
  };

  return (
    <div className="rounded-xl border border-border p-4 bg-card space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">{rand(p.amount)}</p>
          <p className="text-xs text-muted-foreground">{who(p.driver)}</p>
          <p className="text-xs text-muted-foreground">Requested {when(p.requested_at)}</p>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${PAYOUT_CLS[p.status] || 'bg-muted'}`}>{p.status}</span>
      </div>
      <div className="text-xs rounded-lg bg-muted p-2 font-mono">
        {p.bank_account_holder} · {p.bank_name} · {p.bank_account_number} · branch {p.bank_branch_code} · {p.bank_account_type || 'cheque'}
      </div>
      {p.payment_reference && <p className="text-xs text-muted-foreground">EFT ref {p.payment_reference} · {when(p.processed_at)}</p>}
      {p.rejection_reason && <p className="text-xs text-muted-foreground">Not sent: {p.rejection_reason}</p>}
      {open && (
        <div className="flex flex-wrap gap-2">
          {p.status === 'pending' && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => settle('processing')}>
              {busy === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mark processing'}
            </Button>
          )}
          <Button size="sm" disabled={!!busy} onClick={() => settle('paid')}>
            {busy === 'paid' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Mark paid'}
          </Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={!!busy} onClick={() => settle('rejected')}>
            {busy === 'rejected' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reject'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminPayments() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [minPayout, setMinPayout] = useState('');
  const [windowMins, setWindowMins] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await callAdminPayments({ action: 'overview' });
      setData(d);
      setMinPayout(String(d.settings?.gig_min_payout ?? ''));
      setWindowMins(String(d.settings?.gig_payment_window_minutes ?? ''));
    } catch (err) {
      console.error('[AdminPayments] load failed:', err);
      toast.error(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async (patch) => {
    setSaving(true);
    try { await callAdminPayments({ action: 'update_settings', ...patch }); toast.success('Saved ✓'); await load(); }
    catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const refunds = data?.refunds || [];
  const payouts = data?.payouts || [];
  const openRefunds = refunds.filter((r) => r.status !== 'refunded');
  const openPayouts = payouts.filter((p) => p.status === 'pending' || p.status === 'processing');
  const owed = openRefunds.reduce((t, r) => t + Number(r.amount), 0);
  const payoutsOwed = openPayouts.reduce((t, p) => t + Number(p.amount), 0);

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Payments</h1>
          <p className="text-sm text-muted-foreground">Gig refunds and driver payouts</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {data && (
        <>
          <div className="grid sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border p-3 bg-card">
              <p className="text-xs text-muted-foreground">PayFast mode</p>
              <p className={`font-semibold ${data.mode === 'live' ? 'text-green-700' : 'text-amber-700'}`}>{data.mode}</p>
            </div>
            <div className="rounded-xl border border-border p-3 bg-card">
              <p className="text-xs text-muted-foreground">Gig fares, last 30 days</p>
              <p className="font-semibold">{rand(data.gigFaresLast30Days)}</p>
            </div>
            <div className="rounded-xl border border-border p-3 bg-card">
              <p className="text-xs text-muted-foreground">Refunds owed</p>
              <p className="font-semibold">{rand(owed)} ({openRefunds.length})</p>
            </div>
            <div className="rounded-xl border border-border p-3 bg-card">
              <p className="text-xs text-muted-foreground">Payouts requested</p>
              <p className="font-semibold">{rand(payoutsOwed)} ({openPayouts.length})</p>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 bg-card space-y-4">
            <p className="font-semibold text-sm">Settings</p>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={!!data.settings?.gig_auto_refunds}
                disabled={saving || (data.mode !== 'live' && !data.settings?.gig_auto_refunds)}
                onChange={(e) => {
                  const on = e.target.checked;
                  if (on && !window.confirm('Send queued refunds automatically through PayFast? Only switch this on after a live refund has been checked in the PayFast dashboard.')) return;
                  saveSettings({ gig_auto_refunds: on });
                }}
              />
              <span>
                Send refunds automatically
                <span className="block text-xs text-muted-foreground">
                  {data.mode !== 'live'
                    ? "Available in PayFast live mode only — refunds don't work in sandbox."
                    : 'Queued refunds are sent within a minute. Leave off until one live refund has been checked.'}
                </span>
              </span>
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="min-payout">Minimum payout (R)</Label>
                <div className="flex gap-2 mt-1">
                  <Input id="min-payout" type="number" min="0" step="1" value={minPayout} onChange={(e) => setMinPayout(e.target.value)} />
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => saveSettings({ gig_min_payout: Number(minPayout) })}>Save</Button>
                </div>
              </div>
              <div>
                <Label htmlFor="pay-window">Time to pay before a request is cancelled (minutes)</Label>
                <div className="flex gap-2 mt-1">
                  <Input id="pay-window" type="number" min="5" max="240" step="1" value={windowMins} onChange={(e) => setWindowMins(e.target.value)} />
                  <Button size="sm" variant="outline" disabled={saving} onClick={() => saveSettings({ gig_payment_window_minutes: Number(windowMins) })}>Save</Button>
                </div>
              </div>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="font-semibold">Refunds</h2>
            {refunds.length === 0 && <p className="text-sm text-muted-foreground">No refunds yet.</p>}
            {refunds.map((r) => <RefundRow key={r.id} r={r} mode={data.mode} onDone={load} />)}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Driver payouts</h2>
            {payouts.length === 0 && <p className="text-sm text-muted-foreground">No payout requests yet.</p>}
            {payouts.map((p) => <PayoutRow key={p.id} p={p} onDone={load} />)}
          </section>
        </>
      )}

      {!data && loading && (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}
    </div>
  );
}
