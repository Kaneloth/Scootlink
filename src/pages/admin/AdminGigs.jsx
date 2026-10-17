// src/pages/admin/AdminGigs.jsx
//
// Admin oversight of gigs. Route: /admin/gigs.
// Lists gigs by status, resolves disputed gigs (release to driver / void) and
// cancels stuck gigs — all through the admin-gigs Netlify function
// (migration 015). Resolving also closes the linked Disputes Center report.

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, Car, Package } from 'lucide-react';
import { toast } from 'sonner';

const TABS = [
  { key: 'disputed', label: 'Disputed' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const STATUS_CLS = {
  pending: 'bg-blue-100 text-blue-700',
  accepted: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  disputed: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-muted text-muted-foreground',
  no_drivers_available: 'bg-muted text-muted-foreground',
};

const rand = (n) => (n == null ? '—' : `R ${Number(n).toFixed(2)}`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : null);
const person = (p) => (p ? `${p.full_name || 'Unnamed'}${p.customer_code ? ` (${p.customer_code})` : ''}` : '—');

async function callAdminGigs(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/admin-gigs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function GigRow({ gig, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);

  const act = async (action, extra, confirmText) => {
    if (!window.confirm(confirmText)) return;
    setBusy(extra?.outcome || action);
    try {
      await callAdminGigs({ action, gigId: gig.id, note: note.trim() || null, ...extra });
      toast.success('Done ✓');
      onDone();
    } catch (err) {
      console.error('[AdminGigs] action failed:', err);
      toast.error(err.message);
    }
    setBusy(null);
  };

  const Icon = gig.gig_type === 'delivery' ? Package : Car;
  const isActive = ['pending', 'accepted', 'in_progress'].includes(gig.status);

  return (
    <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <div>
            <p className="font-semibold text-sm">Gig #{gig.id} · {gig.gig_type === 'delivery' ? 'Delivery' : 'Ride'}</p>
            <p className="text-xs text-muted-foreground">{when(gig.created_at)}</p>
          </div>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CLS[gig.status] || 'bg-muted'}`}>
          {gig.status.replace(/_/g, ' ')}{gig.admin_resolution ? ` · ${gig.admin_resolution.replace('_', ' ')}` : ''}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <p><span className="text-muted-foreground">Customer:</span> {person(gig.customer)}</p>
        <p><span className="text-muted-foreground">Driver:</span> {person(gig.driver)}</p>
        <p className="sm:col-span-2 truncate"><span className="text-muted-foreground">From:</span> {gig.pickup_address}</p>
        <p className="sm:col-span-2 truncate"><span className="text-muted-foreground">To:</span> {gig.dropoff_address}</p>
        <p><span className="text-muted-foreground">Fare:</span> {rand(gig.fare_amount)}</p>
        {gig.cancellation_fee > 0 && (
          <p><span className="text-muted-foreground">{gig.customer_no_show ? 'No-show fee' : 'Cancellation fee'}:</span> {rand(gig.cancellation_fee)}</p>
        )}
        {gig.driver_payout_amount != null && (
          <p><span className="text-muted-foreground">Commission / driver:</span> {rand(gig.commission_amount)} / {rand(gig.driver_payout_amount)}</p>
        )}
        {gig.auto_confirmed && <p className="text-muted-foreground">Auto-confirmed after 24h</p>}
      </div>

      {gig.dispute_reason && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-900">
          <p className="font-medium text-xs mb-1">Customer's report{gig.disputed_at ? ` · ${when(gig.disputed_at)}` : ''}</p>
          <p className="whitespace-pre-wrap">{gig.dispute_reason}</p>
        </div>
      )}
      {gig.admin_note && (
        <p className="text-xs text-muted-foreground">Admin note: {gig.admin_note}</p>
      )}

      {(gig.status === 'disputed' || isActive) && (
        <div className="space-y-2 pt-1">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Admin note (optional; saved on the gig and the report)"
            rows={2}
          />
          {gig.status === 'disputed' && (
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!!busy}
                onClick={() => act('resolve_dispute', { outcome: 'release' },
                  'Release this gig to the driver? It will complete and the driver\'s earnings will be recorded.')}
              >
                {busy === 'release' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Release to driver
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!!busy}
                onClick={() => act('resolve_dispute', { outcome: 'void' },
                  'Void this gig? It will be closed with no earnings for the driver.')}
              >
                {busy === 'void' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Void
              </Button>
            </div>
          )}
          {isActive && (
            <Button
              variant="outline"
              className="w-full"
              disabled={!!busy}
              onClick={() => act('cancel', {}, 'Cancel this gig? Both people will be told Skootlink support cancelled it. No fee applies.')}
            >
              {busy === 'cancel' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Cancel gig
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminGigs() {
  const [tab, setTab] = useState('disputed');
  const [gigs, setGigs] = useState(null);

  const load = useCallback(async () => {
    setGigs(null);
    try {
      const data = await callAdminGigs({ action: 'list', filter: tab });
      setGigs(data.gigs || []);
    } catch (err) {
      console.error('[AdminGigs] list failed:', err);
      toast.error('Could not load gigs: ' + err.message);
      setGigs([]);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gigs</h2>
          <p className="text-sm text-muted-foreground">Rides and deliveries — latest 100 per view</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-1.5 rounded-full border ${tab === t.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {gigs === null ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : gigs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No gigs here.</p>
      ) : (
        <div className="space-y-3">
          {gigs.map((g) => <GigRow key={g.id} gig={g} onDone={load} />)}
        </div>
      )}
    </div>
  );
}
