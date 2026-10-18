// src/pages/DriverEarnings.jsx
//
// Route: /earnings — the driver's gig earnings and payouts (migration 018).
// No in-app wallet: money only leaves as a bank payout.
//
//   Each completed card gig adds the fare minus commission; a cancellation or
//   no-show fee adds the driver's share of the fee.
//   available = the customer's payment was received; can be paid out
//   pending   = gigs from before card payments existed (no payment taken)
//   withdrawn = paid out
//
// Payout: the driver saves bank details (driver_payout_accounts) and taps
// "Request payout" (request_gig_payout: everything available, one request at
// a time, minimum set by admin). Skootlink pays by EFT and marks it paid.
//
// Cash gigs (migration 020): the driver keeps the cash fare, so each one adds
// a NEGATIVE entry for the commission owed. The balance shown is the net of
// everything. In debt, the driver can pay it off through PayFast
// (driver-settle). Over the admin's debt limit, no cash gigs are offered.
//
// Data: gig_earnings_ledger, withdrawal_requests and driver_payout_accounts
// (RLS: own rows only) and the gigs behind the earnings (RLS: assigned driver).

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { fnUrl } from '@/lib/functionsUrl';
import { openPayfastCheckout, PAYMENT_RESULT_EVENT } from '@/lib/payfastCheckout';
import { auth, supabase } from '@/api/supabaseData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Car, Package, XCircle, ChevronRight, Landmark, Pencil, Banknote, Wallet } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';

const formatRand = (n) => (Number(n) < 0 ? `− R ${Math.abs(Number(n)).toFixed(2)}` : `R ${Number(n || 0).toFixed(2)}`);
const shortDate = (d) => new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

const STATUS_LABEL = {
  pending: { text: 'Not paid in', cls: 'bg-amber-100 text-amber-700' },
  available: { text: 'Available', cls: 'bg-green-100 text-green-700' },
  in_payout: { text: 'In payout', cls: 'bg-blue-100 text-blue-700' },
  withdrawn: { text: 'Paid out', cls: 'bg-muted text-muted-foreground' },
};

const PAYOUT_LABEL = {
  pending: { text: 'Requested', cls: 'bg-blue-100 text-blue-700' },
  processing: { text: 'Processing', cls: 'bg-blue-100 text-blue-700' },
  paid: { text: 'Paid', cls: 'bg-green-100 text-green-700' },
  rejected: { text: 'Not sent', cls: 'bg-red-100 text-red-700' },
};

// Monday 00:00 of the current week, local time
function startOfWeek() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

const EMPTY_BANK = { account_holder: '', bank_name: '', account_number: '', branch_code: '', account_type: 'cheque' };

function BankForm({ meId, initial, onSaved, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_BANK, ...(initial || {}) });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid = form.account_holder.trim().length >= 2 && form.bank_name.trim().length >= 2
    && /^[0-9]{6,16}$/.test(form.account_number) && /^[0-9]{6}$/.test(form.branch_code);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const row = {
      driver_id: meId,
      account_holder: form.account_holder.trim(),
      bank_name: form.bank_name.trim(),
      account_number: form.account_number,
      branch_code: form.branch_code,
      account_type: form.account_type,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('driver_payout_accounts').upsert(row, { onConflict: 'driver_id' });
    setSaving(false);
    if (error) {
      console.error('[DriverEarnings] saving bank details failed:', error);
      toast.error('Could not save your bank details. Please check them and try again.');
      return;
    }
    toast.success('Bank details saved');
    onSaved(row);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="acct-holder">Account holder</Label>
        <Input id="acct-holder" className="mt-1" value={form.account_holder} onChange={set('account_holder')} maxLength={120} />
      </div>
      <div>
        <Label htmlFor="bank-name">Bank</Label>
        <Input id="bank-name" className="mt-1" value={form.bank_name} onChange={set('bank_name')} placeholder="e.g. Capitec" maxLength={80} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="acct-no">Account number</Label>
          <Input id="acct-no" className="mt-1" inputMode="numeric" value={form.account_number}
            onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value.replace(/\D/g, '').slice(0, 16) }))} />
        </div>
        <div>
          <Label htmlFor="branch">Branch code</Label>
          <Input id="branch" className="mt-1" inputMode="numeric" value={form.branch_code}
            onChange={(e) => setForm((f) => ({ ...f, branch_code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
        </div>
      </div>
      <div>
        <Label htmlFor="acct-type">Account type</Label>
        <select id="acct-type" value={form.account_type} onChange={set('account_type')}
          className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="cheque">Cheque / current</option>
          <option value="savings">Savings</option>
          <option value="transmission">Transmission</option>
        </select>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Payouts go only to an account in your own name. Only you and Skootlink's payments team can see these details.
      </p>
      <div className="flex gap-2">
        {onCancel && <Button variant="outline" className="flex-1" onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button className="flex-1" onClick={save} disabled={!valid || saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save bank details'}
        </Button>
      </div>
    </div>
  );
}

export default function DriverEarnings() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [rows, setRows] = useState(null); // [{ ledger, gig }]
  const [balance, setBalance] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [bank, setBank] = useState(null);
  const [editingBank, setEditingBank] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState(null);
  const [cash, setCash] = useState(null); // my_cash_status()
  const [togglingCash, setTogglingCash] = useState(false);
  const [settling, setSettling] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      const user = await auth.me();
      if (!user?.id) throw new Error('Not signed in');
      setMe(user);

      const [ledgerRes, balanceRes, payoutsRes, bankRes, cashRes] = await Promise.all([
        supabase.from('gig_earnings_ledger')
          .select('id, gig_request_id, amount, status, entry_type, withdrawal_id, created_at, available_at, withdrawn_at')
          .eq('driver_id', user.id).order('created_at', { ascending: false }).limit(200),
        supabase.rpc('my_gig_balance'),
        supabase.from('withdrawal_requests')
          .select('id, amount, status, requested_at, processed_at, payment_reference, rejection_reason, bank_name, bank_account_number')
          .eq('driver_id', user.id).order('requested_at', { ascending: false }).limit(50),
        supabase.from('driver_payout_accounts').select('*').eq('driver_id', user.id).maybeSingle(),
        supabase.rpc('my_cash_status'),
      ]);
      for (const r of [ledgerRes, balanceRes, payoutsRes, bankRes, cashRes]) if (r.error) throw r.error;
      setCash((cashRes.data || [])[0] || null);

      const ledger = ledgerRes.data || [];
      const gigIds = [...new Set(ledger.map((l) => l.gig_request_id).filter(Boolean))];
      let gigsById = {};
      if (gigIds.length > 0) {
        const { data: gigs, error: gigsErr } = await supabase
          .from('gig_requests')
          .select('id, gig_type, status, pickup_address, fare_amount, cancellation_fee, customer_no_show, commission_amount')
          .in('id', gigIds);
        if (gigsErr) throw gigsErr;
        gigsById = Object.fromEntries((gigs || []).map((g) => [g.id, g]));
      }

      setRows(ledger.map((l) => ({ ledger: l, gig: gigsById[l.gig_request_id] || null })));
      setBalance((balanceRes.data || [])[0] || null);
      setPayouts(payoutsRes.data || []);
      setBank(bankRes.data || null);
      setError(null);
    } catch (err) {
      console.error('[DriverEarnings] load failed:', err);
      setError('Could not load your earnings. Please try again.');
      setRows((prev) => prev || []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Back from PayFast after paying what's owed (web query param / native event)
  useEffect(() => {
    const result = searchParams.get('payment');
    if (result) {
      if (result === 'success') toast.success('Payment received — your balance updates in a few seconds.');
      else toast('Payment cancelled');
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('payment'); return n; }, { replace: true });
      setTimeout(load, 4000);
    }
    const onResult = (e) => {
      if (e.detail?.category !== 'settlement') return;
      try { sessionStorage.removeItem('skootlink_payment_result'); } catch { /* ignore */ }
      if (e.detail.status === 'success') { toast.success('Payment received — your balance updates in a few seconds.'); setTimeout(load, 4000); }
    };
    window.addEventListener(PAYMENT_RESULT_EVENT, onResult);
    return () => window.removeEventListener(PAYMENT_RESULT_EVENT, onResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCash = async (on) => {
    setTogglingCash(true);
    const { error: rpcErr } = await supabase.rpc('set_accepts_cash', { p_on: on });
    setTogglingCash(false);
    if (rpcErr) { toast.error(rpcErr.message || 'Could not change this setting'); return; }
    toast.success(on ? 'You will now get cash gigs too' : 'Cash gigs turned off');
    load();
  };

  const settleDebt = async () => {
    setSettling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(fnUrl('driver-settle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ is_native: Capacitor.isNativePlatform() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.payment) throw new Error(data.error || 'Payment could not be started');
      await openPayfastCheckout(data.payment);
    } catch (err) {
      console.error('[DriverEarnings] settle failed:', err);
      toast.error(err.message);
    } finally {
      setSettling(false);
    }
  };

  const requestPayout = async () => {
    if (!window.confirm(`Request a payout of ${formatRand(balance?.available)} to ${bank?.bank_name} ••••${String(bank?.account_number || '').slice(-4)}?`)) return;
    setRequesting(true);
    const { error: rpcErr } = await supabase.rpc('request_gig_payout');
    setRequesting(false);
    if (rpcErr) {
      console.error('[DriverEarnings] request_gig_payout failed:', rpcErr);
      toast.error(rpcErr.message || 'Could not request the payout');
    } else {
      toast.success('Payout requested. We pay out by EFT, usually within a week.');
    }
    load();
  };

  if (rows === null) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const weekStart = startOfWeek();
  const thisWeekRows = rows.filter((r) => new Date(r.ledger.created_at) >= weekStart);
  const thisWeek = thisWeekRows.reduce((t, r) => t + Number(r.ledger.amount || 0), 0);
  const available = Number(balance?.available || 0);
  const owes = available < 0 ? -available : 0;
  const debtLimit = Number(cash?.debt_limit ?? 200);
  const minPayout = Number(balance?.min_payout ?? 100);
  const openRequest = payouts.find((p) => p.id === balance?.open_request_id);

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
          {thisWeekRows.length} {thisWeekRows.length === 1 ? 'earning' : 'earnings'} since Monday
        </p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className={`rounded-xl p-3 ${owes > 0 ? 'bg-red-50' : 'bg-muted'}`}>
            <p className="text-xs text-muted-foreground">{owes > 0 ? 'You owe Skootlink' : 'Available to pay out'}</p>
            <p className={`font-semibold ${owes > 0 ? 'text-red-700' : ''}`}>{formatRand(owes > 0 ? owes : available)}</p>
          </div>
          <div className="rounded-xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">In a payout</p>
            <p className="font-semibold">{formatRand(balance?.in_payout)}</p>
          </div>
        </div>
        {Number(balance?.pending || 0) > 0 && (
          <p className="text-[11px] text-muted-foreground mt-3">
            {formatRand(balance.pending)} is from gigs before card payments started, where no payment was collected, so it can't be paid out.
          </p>
        )}

        {owes > 0 && (
          <div className="mt-4 rounded-lg bg-red-50 text-red-900 p-3 text-sm space-y-2">
            <p>
              This is commission from your cash gigs. It comes off your card earnings automatically, or you can pay it now.
              {owes > debtLimit && ` You owe more than ${formatRand(debtLimit)}, so you won't get cash gigs until it's back under that.`}
            </p>
            <Button size="sm" className="gap-2" onClick={settleDebt} disabled={settling || owes < 5}>
              {settling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
              Pay {formatRand(owes)} now
            </Button>
          </div>
        )}

        {owes > 0 ? null : openRequest ? (
          <p className="text-sm mt-4 rounded-lg bg-blue-50 text-blue-800 p-3">
            Payout of {formatRand(openRequest.amount)} requested on {shortDate(openRequest.requested_at)}. We'll let you know when it's paid.
          </p>
        ) : bank ? (
          <>
            <Button className="w-full mt-4 gap-2" disabled={available < minPayout || requesting} onClick={requestPayout}>
              {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />}
              Request payout
            </Button>
            <p className="text-[11px] text-center text-muted-foreground mt-2">
              {available < minPayout
                ? `The minimum payout is ${formatRand(minPayout)}.`
                : 'Paid by EFT to your bank account, usually within a week.'}
            </p>
          </>
        ) : null}
      </Card>

      {cash && (
        <Card className="p-5 border border-border/50">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={!!cash.accepts_cash}
              disabled={togglingCash}
              onChange={(e) => toggleCash(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-semibold flex items-center gap-1.5"><Banknote className="w-4 h-4" /> Take cash gigs</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                The customer pays you the fare in cash. The commission is then owed to Skootlink
                and comes off your card earnings (or you pay it here). Above {formatRand(debtLimit)} owed, cash gigs pause.
              </span>
              {cash.accepts_cash && !cash.can_take_cash && (
                <span className="block text-xs text-red-700 mt-1">Paused: you owe more than {formatRand(debtLimit)}.</span>
              )}
            </span>
          </label>
        </Card>
      )}

      <Card className="p-5 border border-border/50">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Bank account for payouts</p>
          {bank && !editingBank && (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setEditingBank(true)}>
              <Pencil className="w-3.5 h-3.5" /> Change
            </Button>
          )}
        </div>
        {bank && !editingBank ? (
          <div className="text-sm space-y-0.5">
            <p>{bank.account_holder}</p>
            <p className="text-muted-foreground">{bank.bank_name} · ••••{String(bank.account_number).slice(-4)} · {bank.account_type}</p>
            {openRequest && <p className="text-[11px] text-muted-foreground mt-1">Changes apply to your next payout request.</p>}
          </div>
        ) : me ? (
          <BankForm
            meId={me.id}
            initial={bank}
            onSaved={(row) => { setBank(row); setEditingBank(false); }}
            onCancel={bank ? () => setEditingBank(false) : null}
          />
        ) : null}
      </Card>

      {payouts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Payouts</p>
          {payouts.map((p) => {
            const badge = PAYOUT_LABEL[p.status] || PAYOUT_LABEL.pending;
            return (
              <Card key={p.id} className="p-4 border border-border/50">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{formatRand(p.amount)}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Requested {shortDate(p.requested_at)}
                  {p.status === 'paid' && p.processed_at && ` · paid ${shortDate(p.processed_at)}`}
                  {p.payment_reference && ` · ref ${p.payment_reference}`}
                </p>
                {p.status === 'rejected' && p.rejection_reason && (
                  <p className="text-[11px] text-red-700 mt-1">{p.rejection_reason}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-semibold">History</p>
        {rows.length === 0 && !error && (
          <Card className="p-5 border border-border/50 text-sm text-muted-foreground">
            No earnings yet. Completed gigs will appear here.
          </Card>
        )}
        {rows.map(({ ledger, gig }) => {
          const isFee = ledger.entry_type === 'cancellation_fee';
          const isCashCommission = ledger.entry_type === 'cash_commission';
          const isSettlement = ledger.entry_type === 'settlement';
          const gross = isFee ? gig?.cancellation_fee : gig?.fare_amount;
          const Icon = isSettlement ? Wallet : isCashCommission ? Banknote : isFee ? XCircle : gig?.gig_type === 'delivery' ? Package : Car;
          const kind = gig?.gig_type === 'delivery' ? 'delivery' : 'ride';
          const label = isSettlement ? 'You paid Skootlink'
            : isCashCommission ? `Cash ${kind} — commission owed`
            : isFee ? (gig?.customer_no_show ? 'No-show fee' : 'Cancellation fee')
            : gig?.gig_type === 'delivery' ? 'Delivery' : 'Ride';
          const state = ledger.status === 'available' && ledger.withdrawal_id ? 'in_payout' : ledger.status;
          const badge = STATUS_LABEL[state] || STATUS_LABEL.pending;
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
                  <p className="text-xs text-muted-foreground truncate">
                    {isSettlement ? 'Payment through PayFast' : gig?.pickup_address || `Gig #${ledger.gig_request_id}`}
                  </p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-[11px] text-muted-foreground">
                      {shortDate(ledger.created_at)}
                      {isCashCommission && gross != null && ` · you collected ${formatRand(gross)} cash`}
                      {!isCashCommission && !isSettlement && gross != null && ` · ${formatRand(gross)} − ${formatRand(gig?.commission_amount)} commission`}
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
