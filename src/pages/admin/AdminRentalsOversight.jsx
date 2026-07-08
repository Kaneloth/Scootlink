// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Search, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';

const PAGE_SIZE = 25;

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
  rejected: 'bg-red-100 text-red-600',
};

export default function AdminRentalsOversight() {
  const [rentals, setRentals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: rentalRows, error } = await supabase
        .from('rentals')
        .select('id, vehicle_id, driver_id, owner_id, start_date, end_date, status, price_per_week, deposit, message, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) {
        toast.error('Could not load rentals: ' + error.message);
        setLoading(false);
        return;
      }

      const vehicleIds = [...new Set((rentalRows || []).map(r => r.vehicle_id).filter(Boolean))];
      const userIds = [...new Set(
        (rentalRows || []).flatMap(r => [r.driver_id, r.owner_id]).filter(Boolean)
      )];

      const [{ data: vehicles }, { data: profiles }] = await Promise.all([
        vehicleIds.length
          ? supabase.from('vehicles').select('id, make, model, year, plate').in('id', vehicleIds)
          : Promise.resolve({ data: [] }),
        userIds.length
          ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
          : Promise.resolve({ data: [] }),
      ]);

      const vehicleMap = Object.fromEntries((vehicles || []).map(v => [v.id, v]));
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      setRentals((rentalRows || []).map(r => ({
        ...r,
        vehicle: vehicleMap[r.vehicle_id] || null,
        driver: profileMap[r.driver_id] || null,
        owner: profileMap[r.owner_id] || null,
      })));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = rentals;
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        String(r.id).includes(q) ||
        r.driver?.full_name?.toLowerCase().includes(q) ||
        r.driver?.email?.toLowerCase().includes(q) ||
        r.owner?.full_name?.toLowerCase().includes(q) ||
        r.owner?.email?.toLowerCase().includes(q) ||
        r.vehicle?.make?.toLowerCase().includes(q) ||
        r.vehicle?.model?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [rentals, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const updateStatus = async (rental, newStatus) => {
    setBusy(true);
    const { error } = await supabase.from('rentals').update({ status: newStatus }).eq('id', rental.id);
    if (error) {
      toast.error('Failed to update: ' + error.message);
    } else {
      setRentals(prev => prev.map(r => r.id === rental.id ? { ...r, status: newStatus } : r));
      toast.success(`Rental marked as ${newStatus}`);
      setSelected(null);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Rentals Oversight</h2>

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              placeholder="Search by ID, driver, owner, vehicle…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-3 py-2 w-72 border rounded-lg text-sm bg-background"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-2 text-sm bg-background"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} rental(s)</span>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-left">ID</th>
                <th className="p-3 text-left">Vehicle</th>
                <th className="p-3 text-left">Driver</th>
                <th className="p-3 text-left">Owner</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">R/week</th>
                <th className="p-3 text-left">Dates</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
              ) : pageItems.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No rentals found.</td></tr>
              ) : (
                pageItems.map(r => (
                  <tr key={r.id} className="border-t hover:bg-muted/50 cursor-pointer" onClick={() => setSelected(r)}>
                    <td className="p-3 font-mono text-xs">#{r.id}</td>
                    <td className="p-3">{r.vehicle ? `${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.year})` : `Vehicle #${r.vehicle_id}`}</td>
                    <td className="p-3">{r.driver?.full_name || r.driver?.email || '—'}</td>
                    <td className="p-3">{r.owner?.full_name || r.owner?.email || '—'}</td>
                    <td className="p-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[r.status] || 'bg-gray-100'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">R {r.price_per_week ?? '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{r.start_date} → {r.end_date}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/50" onClick={() => setSelected(null)}>
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto border border-border p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Rental #{selected.id}</h3>
              <button onClick={() => setSelected(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <div className="space-y-1.5 text-sm">
              {[
                ['Status', selected.status],
                ['Vehicle', selected.vehicle ? `${selected.vehicle.make} ${selected.vehicle.model} (${selected.vehicle.year})` : `#${selected.vehicle_id}`],
                ['Plate', selected.vehicle?.plate],
                ['Driver', selected.driver?.full_name || selected.driver?.email],
                ['Owner', selected.owner?.full_name || selected.owner?.email],
                ['Rate/Week', selected.price_per_week != null ? `R ${selected.price_per_week}` : null],
                ['Deposit', selected.deposit != null ? `R ${selected.deposit}` : null],
                ['Start', selected.start_date],
                ['End', selected.end_date],
                ['Created', selected.created_at ? new Date(selected.created_at).toLocaleString('en-ZA') : null],
                ['Message', selected.message],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-right max-w-[60%]">{value}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
              <button onClick={() => updateStatus(selected, 'active')} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border">Mark Active</button>
              <button onClick={() => updateStatus(selected, 'completed')} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border">Mark Completed</button>
              <button onClick={() => updateStatus(selected, 'cancelled')} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border text-red-600 border-red-300">Cancel Rental</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
