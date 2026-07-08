import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import {
  Loader2, Search, ShieldCheck, Ban, Coins, Crown, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { toast } from 'sonner';

const PAGE_SIZE = 25;

export default function AdminUserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [banReason, setBanReason] = useState('');
  const [suspendDays, setSuspendDays] = useState('7');
  const [suspendReason, setSuspendReason] = useState('');
  const [creditAmount, setCreditAmount] = useState('50');

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, email, full_name, verified, id_verified, licence_verified, license_pending, ' +
        'verification_badge, account_type, customer_code, phone, location, residential_address, ' +
        'license_number, license_year, blacklisted, banned, suspended_until, ban_reason, ' +
        'suspension_reason, id_document_number, id_document_type, is_admin, created_at'
      )
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Could not load users: ' + error.message);
      setLoading(false);
      return;
    }

    const ids = (data || []).map(u => u.id);
    const balances = await Promise.all(
      ids.map(async (id) => {
        const { data: bal, error: balErr } = await supabase.rpc('get_credit_balance', { p_user_id: id });
        return [id, balErr ? 0 : (bal ?? 0)];
      })
    );
    const balanceMap = Object.fromEntries(balances);
    setUsers((data || []).map(u => ({ ...u, credit_balance: balanceMap[u.id] ?? 0 })));
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (filter === 'banned') list = list.filter(u => u.banned);
    else if (filter === 'suspended') list = list.filter(u => u.suspended_until && new Date(u.suspended_until) > new Date());
    else if (filter === 'verified') list = list.filter(u => u.id_verified);
    else if (filter === 'unverified') list = list.filter(u => !u.id_verified);
    else if (filter !== 'all') list = list.filter(u => u.account_type === filter);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(u =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.customer_code?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Actions — identical logic to Settings.jsx's admin tab ────────────────
  const toggleVerified = async (u) => {
    setBusyId(u.id);
    const { error } = await supabase.from('profiles').update({ verified: !u.verified }).eq('id', u.id);
    if (!error) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, verified: !u.verified } : x));
      toast.success(u.verified ? 'User unverified' : 'User verified ✓');
    } else toast.error('Failed to update verification');
    setBusyId(null);
  };

  const toggleAdminRole = async (u) => {
    setBusyId(u.id);
    const granting = !u.is_admin;
    try {
      const { error } = await supabase.from('profiles').update({ is_admin: granting }).eq('id', u.id);
      if (error) throw error;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (token) {
        await fetch('https://skootlink.co.za/.netlify/functions/admin-set-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId: u.id, is_admin: granting }),
        });
      }
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: granting } : x));
      toast.success(granting ? '✅ Admin rights granted' : 'Admin rights removed');
    } catch (err) {
      toast.error('Failed to update admin role: ' + err.message);
    }
    setBusyId(null);
  };

  const banUser = async (u, reason) => {
    setBusyId(u.id);
    const banning = !u.banned;

    const { error } = await supabase.from('profiles')
      .update({ banned: banning, ban_reason: banning ? reason : null })
      .eq('id', u.id);

    if (error) {
      toast.error('Failed to update ban status: ' + error.message);
      setBusyId(null);
      return;
    }

    const { data: sensitiveRow } = await supabase
      .from('user_sensitive_info')
      .select('sa_id, passport')
      .eq('user_id', u.id)
      .maybeSingle();
    const idNum = (sensitiveRow?.sa_id || sensitiveRow?.passport || '').trim().toUpperCase();
    if (idNum) {
      if (banning) await supabase.from('blacklisted_id_numbers').upsert({ id_number: idNum }, { onConflict: 'id_number' });
      else await supabase.from('blacklisted_id_numbers').delete().eq('id_number', idNum);
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (token) {
        await fetch('https://skootlink.co.za/.netlify/functions/admin-ban-user', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId: u.id, ban: banning }),
        });
      }
    } catch { /* non-fatal — profiles.banned still blocks app access */ }

    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, banned: banning, ban_reason: banning ? reason : null } : x));
    if (selected?.id === u.id) setSelected(p => ({ ...p, banned: banning, ban_reason: banning ? reason : null }));
    toast.success(banning ? 'User banned ⛔' : 'User unbanned ✓');
    setBusyId(null);
    setBanReason('');
  };

  const suspendUser = async (u, days, reason) => {
    setBusyId(u.id);
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('profiles').update({ suspended_until: until, suspension_reason: reason }).eq('id', u.id);
    if (error) {
      toast.error('Failed to suspend: ' + error.message);
    } else {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, suspended_until: until, suspension_reason: reason } : x));
      if (selected?.id === u.id) setSelected(p => ({ ...p, suspended_until: until, suspension_reason: reason }));
      toast.success(`User suspended for ${days} day${days !== 1 ? 's' : ''} ⏳`);
    }
    setBusyId(null);
    setSuspendReason('');
  };

  const unsuspendUser = async (u) => {
    setBusyId(u.id);
    const { error } = await supabase.from('profiles').update({ suspended_until: null, suspension_reason: null }).eq('id', u.id);
    if (error) {
      toast.error('Failed to unsuspend: ' + error.message);
    } else {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, suspended_until: null, suspension_reason: null } : x));
      if (selected?.id === u.id) setSelected(p => ({ ...p, suspended_until: null, suspension_reason: null }));
      toast.success('User unsuspended ✓');
    }
    setBusyId(null);
  };

  const adjustCredits = async (u, amount) => {
    setBusyId(u.id);
    const { error } = await supabase.rpc('add_credits', {
      p_user_id: u.id,
      p_amount: amount,
      p_type: 'adjustment',
      p_description: 'Admin credit adjustment',
      p_ref_id: `admin:${u.id}`,
    });
    if (!error) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, credit_balance: (x.credit_balance || 0) + amount } : x));
      toast.success(`${amount > 0 ? 'Added' : 'Subtracted'} ${Math.abs(amount)} credits`);
    } else {
      toast.error('Credit adjustment failed: ' + error.message);
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">User Management</h2>

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              placeholder="Search name, email, or code…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-3 py-2 w-64 border rounded-lg text-sm bg-background"
            />
          </div>
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-2 text-sm bg-background"
          >
            <option value="all">All Users</option>
            <option value="driver">Drivers</option>
            <option value="owner">Owners</option>
            <option value="both">Fleet Pro</option>
            <option value="verified">ID Verified</option>
            <option value="unverified">Unverified</option>
            <option value="banned">Banned</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} user(s)</span>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Credits</th>
                <th className="p-3 text-left">Joined</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
              ) : pageItems.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No users found.</td></tr>
              ) : (
                pageItems.map(u => {
                  const suspended = u.suspended_until && new Date(u.suspended_until) > new Date();
                  return (
                    <tr
                      key={u.id}
                      className={`border-t cursor-pointer hover:bg-muted/50 ${u.banned ? 'bg-red-50/60' : suspended ? 'bg-amber-50/60' : ''}`}
                      onClick={() => setSelected(u)}
                    >
                      <td className="p-3 font-medium">
                        {u.full_name || '—'}
                        {u.id_verified && <ShieldCheck className="w-3.5 h-3.5 inline ml-1 text-green-600" />}
                        {u.is_admin && <Crown className="w-3.5 h-3.5 inline ml-1 text-amber-500" />}
                      </td>
                      <td className="p-3 text-muted-foreground">{u.email}</td>
                      <td className="p-3 capitalize">{u.account_type || '—'}</td>
                      <td className="p-3 text-center">
                        {u.banned ? <span className="text-red-600 font-medium text-xs">⛔ Banned</span>
                         : suspended ? <span className="text-amber-600 font-medium text-xs">⏳ Suspended</span>
                         : u.id_verified ? <span className="text-green-600 font-medium text-xs">✅ Verified</span>
                         : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="p-3 text-right font-mono">{u.credit_balance ?? 0}</td>
                      <td className="p-3 text-muted-foreground">{u.created_at ? new Date(u.created_at).toLocaleDateString('en-ZA') : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

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

      {/* Detail / actions panel */}
      {selected && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/50" onClick={() => setSelected(null)}>
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto border border-border p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg">{selected.full_name || '—'}</h3>
                <p className="text-xs text-muted-foreground">{selected.email} · {selected.customer_code}</p>
              </div>
              <button onClick={() => setSelected(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>

            <div className="space-y-1 text-sm mb-4">
              {[
                ['Phone', selected.phone],
                ['Location', selected.location],
                ['Address', selected.residential_address],
                ['Account Type', selected.account_type],
                ['Credit Balance', selected.credit_balance],
                ['Ban Reason', selected.ban_reason],
                ['Suspension Reason', selected.suspension_reason],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-border/50 py-1.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-right">{value}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => toggleVerified(selected)}
                  disabled={busyId === selected.id}
                  className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> {selected.verified ? 'Un-verify' : 'Verify'}
                </button>
                <button
                  onClick={() => toggleAdminRole(selected)}
                  disabled={busyId === selected.id}
                  className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1"
                >
                  <Crown className="w-3.5 h-3.5" /> {selected.is_admin ? 'Remove Admin' : 'Make Admin'}
                </button>
                {selected.suspended_until && new Date(selected.suspended_until) > new Date() && (
                  <button
                    onClick={() => unsuspendUser(selected)}
                    disabled={busyId === selected.id}
                    className="text-xs px-3 py-1.5 rounded-lg border text-amber-600 border-amber-300"
                  >
                    Unsuspend
                  </button>
                )}
              </div>

              {/* Credits */}
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  type="number"
                  value={creditAmount}
                  onChange={e => setCreditAmount(e.target.value)}
                  className="w-24 border rounded-lg px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => adjustCredits(selected, Math.abs(parseInt(creditAmount) || 0))}
                  disabled={busyId === selected.id}
                  className="text-xs px-3 py-1.5 rounded-lg border"
                >
                  Add
                </button>
                <button
                  onClick={() => adjustCredits(selected, -Math.abs(parseInt(creditAmount) || 0))}
                  disabled={busyId === selected.id}
                  className="text-xs px-3 py-1.5 rounded-lg border"
                >
                  Subtract
                </button>
              </div>

              {/* Suspend */}
              {!(selected.suspended_until && new Date(selected.suspended_until) > new Date()) && !selected.banned && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={suspendDays}
                    onChange={e => setSuspendDays(e.target.value)}
                    className="w-16 border rounded-lg px-2 py-1.5 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">days</span>
                  <input
                    placeholder="Reason"
                    value={suspendReason}
                    onChange={e => setSuspendReason(e.target.value)}
                    className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => suspendUser(selected, parseInt(suspendDays) || 1, suspendReason || null)}
                    disabled={busyId === selected.id}
                    className="text-xs px-3 py-1.5 rounded-lg border text-amber-600 border-amber-300"
                  >
                    Suspend
                  </button>
                </div>
              )}

              {/* Ban */}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                {!selected.banned && (
                  <input
                    placeholder="Ban reason"
                    value={banReason}
                    onChange={e => setBanReason(e.target.value)}
                    className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                  />
                )}
                <button
                  onClick={() => banUser(selected, selected.banned ? null : (banReason || null))}
                  disabled={busyId === selected.id}
                  className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 ${
                    selected.banned ? 'bg-red-600 text-white' : 'border text-red-600 border-red-300'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5" /> {selected.banned ? 'Unban' : 'Ban'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
