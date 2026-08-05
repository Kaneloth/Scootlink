import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const TYPE_STYLES = {
  credit_purchase:       { label: 'Credit Purchase',      color: 'text-emerald-600' },
  verification_payment:  { label: 'Verification Payment', color: 'text-emerald-600' },
  credit_refund:         { label: 'Credit Refund',        color: 'text-amber-600' },
  cash_refund:           { label: 'Cash Refund',          color: 'text-amber-600' },
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

  // Transaction numbers are assigned by chronological order (oldest = #1)
  // from the full unfiltered list, so a number stays tied to that specific
  // transaction — it doesn't shift around when you filter, search, or
  // change page. Default display order is still newest-first below.
  const numbered = useMemo(() => {
    const ascending = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const numberMap = new Map(ascending.map((t, i) => [t.id, i + 1]));
    return transactions.map(t => ({ ...t, seq: numberMap.get(t.id) }));
  }, [transactions]);

  const filtered = useMemo(() => {
    let rows = numbered;
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
    // Default sort: newest transaction first.
    return [...rows].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [numbered, search, typeFilter]);

  useEffect(() => { setPage(1); }, [search, typeFilter]);

  const exportCsv = () => {
    const headers = ['#', 'Type', 'Customer Code', 'User', 'Email', 'Detail', 'Amount', 'Unit', 'Date'];
    const escapeCsv = (val) => {
      const s = String(val ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filtered.map(t => [
      t.seq,
      TYPE_STYLES[t.type]?.label || t.label,
      t.profile?.customer_code || '',
      t.profile?.full_name || '',
      t.profile?.email || '',
      t.detail || '',
      t.amount,
      t.unit === 'ZAR' ? 'ZAR' : 'credits',
      new Date(t.date).toISOString(),
    ]);
    const csv = [headers, ...rows].map(r => r.map(escapeCsv).join(',')).join('\r\n');
    // Leading BOM so Excel reliably detects UTF-8 rather than guessing wrong
    // and mangling anything non-ASCII in a name.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skootlink-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            disabled={loading || filtered.length === 0}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={fetchTransactions} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
          </button>
        </div>
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

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-left">#</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Customer Code</th>
                <th className="p-3 text-left">User</th>
                <th className="p-3 text-left">Detail</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No transactions found.</td></tr>
              ) : (
                pageRows.map(t => {
                  const style = TYPE_STYLES[t.type] || { label: t.label, color: 'text-foreground' };
                  return (
                    <tr key={t.id} className="border-t hover:bg-muted/50">
                      <td className="p-3 text-muted-foreground font-mono">{t.seq}</td>
                      <td className={`p-3 font-medium ${style.color}`}>{style.label}</td>
                      <td className="p-3 font-mono text-muted-foreground">{t.profile?.customer_code || '—'}</td>
                      <td className="p-3">{t.profile?.full_name || 'Unknown user'}</td>
                      <td className="p-3 text-muted-foreground capitalize">{t.detail ? t.detail.replace(/_/g, ' ') : '—'}</td>
                      <td className="p-3 text-right font-mono">
                        {t.unit === 'ZAR' ? `R ${t.amount}` : `${t.amount} cr`}
                      </td>
                      <td className="p-3 text-muted-foreground">{new Date(t.date).toLocaleString('en-ZA')}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
