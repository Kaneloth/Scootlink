import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Search, ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const TYPE_STYLES = {
  credit_purchase:       { label: 'Credit Purchase',       color: 'bg-emerald-50 text-emerald-700 border-emerald-200', direction: 'in' },
  verification_payment:  { label: 'Verification Payment',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200', direction: 'in' },
  credit_refund:         { label: 'Credit Refund',         color: 'bg-amber-50 text-amber-700 border-amber-200',       direction: 'out' },
  cash_refund:           { label: 'Cash Refund',           color: 'bg-amber-50 text-amber-700 border-amber-200',       direction: 'out' },
};

export default function AdminTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch('https://skootlink.co.za/.netlify/functions/admin-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load transactions');
      setTransactions(data.transactions || []);
    } catch (err) {
      toast.error('Could not load transactions: ' + err.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTransactions(); }, []);

  const filtered = useMemo(() => {
    let rows = transactions;
    if (typeFilter !== 'all') rows = rows.filter(t => t.type === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(t =>
        t.profile?.full_name?.toLowerCase().includes(q) ||
        t.profile?.email?.toLowerCase().includes(q) ||
        t.profile?.customer_code?.toLowerCase().includes(q) ||
        t.detail?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [transactions, search, typeFilter]);

  useEffect(() => { setPage(1); }, [search, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Transactions</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={fetchTransactions} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            placeholder="Search name, email, customer code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 w-full border rounded-lg text-sm bg-background"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-background"
        >
          <option value="all">All types</option>
          <option value="credit_purchase">Credit Purchases</option>
          <option value="verification_payment">Verification Payments</option>
          <option value="credit_refund">Credit Refunds</option>
          <option value="cash_refund">Cash Refunds</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">
          No transactions found.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {pageRows.map(t => {
              const style = TYPE_STYLES[t.type] || { label: t.label, color: 'bg-muted text-muted-foreground border-border', direction: 'in' };
              return (
                <div key={t.id} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 flex-wrap">
                  {style.direction === 'in'
                    ? <ArrowDownCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                    : <ArrowUpCircle className="w-5 h-5 text-amber-600 shrink-0" />}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${style.color}`}>
                        {style.label}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {t.profile?.full_name || 'Unknown user'}
                      </span>
                      {t.profile?.customer_code && (
                        <span className="text-xs text-muted-foreground font-mono">{t.profile.customer_code}</span>
                      )}
                    </div>
                    {t.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate capitalize">{t.detail.replace(/_/g, ' ')}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">
                      {t.unit === 'ZAR' ? `R ${t.amount}` : `${t.amount} credits`}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(t.date).toLocaleString('en-ZA')}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border disabled:opacity-50"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
