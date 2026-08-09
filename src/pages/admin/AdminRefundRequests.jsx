import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Search, Banknote, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AdminRefundRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [busyId, setBusyId]     = useState(null);

  const callFn = async (payload) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch('/.netlify/functions/admin-refund-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Request failed');
    return data;
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const data = await callFn({ action: 'list' });
      setRequests(data.requests || []);
    } catch (err) {
      toast.error('Could not load refund requests: ' + err.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRequests(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return requests;
    const q = search.trim().toLowerCase();
    return requests.filter(r =>
      r.profile?.full_name?.toLowerCase().includes(q) ||
      r.profile?.email?.toLowerCase().includes(q) ||
      r.profile?.phone?.includes(q) ||
      r.service_type?.toLowerCase().includes(q)
    );
  }, [requests, search]);

  const markRefunded = async (request) => {
    setBusyId(request.id);
    try {
      await callFn({ action: 'mark_refunded', requestId: request.id });
      setRequests(prev => prev.filter(r => r.id !== request.id));
      toast.success(`Marked as refunded — ${request.profile?.full_name || request.profile?.email || 'user'}`);
    } catch (err) {
      toast.error('Could not mark as refunded: ' + err.message);
      // A 409 here means someone else already processed it — refresh so
      // the list reflects reality instead of showing a stale pending row.
      fetchRequests();
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Refund Requests</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${requests.length} pending cash refund${requests.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={fetchRequests} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
        </button>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-300">
        This is a record-keeping tool, not a payment system. Complete the actual refund yourself (EFT, PayFast merchant dashboard, etc.) <span className="font-semibold">before</span> clicking "Mark as Refunded" below — this button only records that it's done, it does not move any money.
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          placeholder="Search name, email, phone, or service…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 pr-3 py-2 w-full border rounded-lg text-sm bg-background"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">
          No pending refund requests.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-sm">
                    {r.profile?.full_name || 'Unknown user'}
                    {!r.profile && (
                      <span className="ml-2 text-xs text-red-600 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> No profile found
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.profile?.email} {r.profile?.phone ? `· ${r.profile.phone}` : ''} {r.profile?.customer_code ? `· ${r.profile.customer_code}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">
                    {r.service_type?.replace('_', ' ')} · {r.reason} · {new Date(r.created_at).toLocaleString('en-ZA')}
                  </p>
                </div>
                <span className="text-sm font-bold shrink-0">R {r.amount}</span>
              </div>

              <div className="flex justify-end mt-3 pt-3 border-t border-border">
                <button
                  onClick={() => markRefunded(r)}
                  disabled={busyId === r.id}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Banknote className="w-3.5 h-3.5" /> Mark as Refunded</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
