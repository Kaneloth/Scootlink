// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Search, Coins, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const REASON_LABELS = {
  email_known: 'Email already used for a grant',
  already_granted: 'Duplicate check blocked it',
  phone_known: 'Phone number already used',
  ip_limit: 'IP address grant limit reached',
  invalid_user: 'Invalid user ID at time of attempt',
  error: 'Technical error during grant',
};

// Fallback shown only until the real app_settings values load, or if that
// fetch fails — mirrors the same fallback defaults grant-signup-credits.js
// uses server-side, so the two never visibly disagree.
const FALLBACK_DRIVER_CREDITS = 350;
const FALLBACK_OWNER_CREDITS = 1250;

export default function AdminCreditGrants() {
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [amounts, setAmounts] = useState({});

  const [baseCredits, setBaseCredits] = useState({ driver: FALLBACK_DRIVER_CREDITS, owner: FALLBACK_OWNER_CREDITS });
  const [baseCreditsInput, setBaseCreditsInput] = useState({ driver: String(FALLBACK_DRIVER_CREDITS), owner: String(FALLBACK_OWNER_CREDITS) });
  const [baseCreditsLoading, setBaseCreditsLoading] = useState(true);
  const [savingBaseCredits, setSavingBaseCredits] = useState(false);

  const creditsForType = (profileType) =>
    (profileType === 'owner' || profileType === 'both') ? baseCredits.owner : baseCredits.driver;

  // ── Shared helper for the new admin-signup-grants function ──────────────────
  // signup_grant_attempts (and profiles/credit_ledger, read alongside it) have
  // RLS enabled with zero policies — a direct client-side query silently
  // returns nothing, no error thrown. This reads/writes everything server-side
  // with the service role instead of ever loosening that table's RLS, since it
  // holds other users' emails, IPs, and phone-based fraud signals.
  const callFn = async (payload) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch('https://skootlink.co.za/.netlify/functions/admin-signup-grants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Request failed');
    return data;
  };

  const fetchDenied = async () => {
    setLoading(true);
    try {
      const data = await callFn({ action: 'list' });
      const merged = data.attempts || [];
      setAttempts(merged);
      setAmounts(Object.fromEntries(merged.map(r => [r.user_id, creditsForType(r.profile_type)])));
    } catch (err) {
      toast.error('Could not load denied grants: ' + err.message);
    }
    setLoading(false);
  };

  const fetchBaseCredits = async () => {
    setBaseCreditsLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch('https://skootlink.co.za/.netlify/functions/admin-app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'get' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load settings');
      const driver = Number.isInteger(data.signup_credits_driver) ? data.signup_credits_driver : FALLBACK_DRIVER_CREDITS;
      const owner  = Number.isInteger(data.signup_credits_owner)  ? data.signup_credits_owner  : FALLBACK_OWNER_CREDITS;
      setBaseCredits({ driver, owner });
      setBaseCreditsInput({ driver: String(driver), owner: String(owner) });
    } catch (err) {
      toast.error('Could not load signup credit amounts: ' + err.message);
    }
    setBaseCreditsLoading(false);
  };

  const saveBaseCredits = async () => {
    const driver = parseInt(baseCreditsInput.driver, 10);
    const owner = parseInt(baseCreditsInput.owner, 10);
    if (!Number.isInteger(driver) || driver < 0 || !Number.isInteger(owner) || owner < 0) {
      toast.error('Enter non-negative whole numbers for both amounts.');
      return;
    }
    setSavingBaseCredits(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const res = await fetch('https://skootlink.co.za/.netlify/functions/admin-app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'update_signup_credits', driver_credits: driver, owner_credits: owner }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      setBaseCredits({ driver, owner });
      toast.success('Signup credit amounts updated ✓');
    } catch (err) {
      toast.error('Could not save: ' + err.message);
    }
    setSavingBaseCredits(false);
  };

  useEffect(() => {
    (async () => {
      // Load the real base amounts first — fetchDenied() prefills each row's
      // grant amount from creditsForType(), which reads baseCredits, so the
      // prefill should reflect the actual configured values, not fallbacks.
      await fetchBaseCredits();
      await fetchDenied();
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return attempts;
    const q = search.trim().toLowerCase();
    return attempts.filter(a =>
      a.profile?.full_name?.toLowerCase().includes(q) ||
      a.profile?.email?.toLowerCase().includes(q) ||
      a.email?.toLowerCase().includes(q) ||
      a.ip?.includes(q)
    );
  }, [attempts, search]);

  const grantCredits = async (attempt) => {
    const userId = attempt.user_id;
    const profile = attempt.profile;
    if (!profile) {
      toast.error('No matching profile — cannot grant.');
      return;
    }

    setBusyId(userId);
    const amount = amounts[userId] || creditsForType(attempt.profile_type);

    try {
      const data = await callFn({ action: 'grant', userId, amount });
      if (data.alreadyResolved) {
        toast.error('Already granted — refreshing list.');
        setAttempts(prev => prev.map(a => a.user_id === userId ? { ...a, alreadyResolved: true } : a));
        setBusyId(null);
        return;
      }
      setAttempts(prev => prev.map(a => a.user_id === userId ? { ...a, alreadyResolved: true } : a));
      toast.success(`Granted ${amount} credits to ${profile.full_name || profile.email}`);
    } catch (err) {
      toast.error('Grant failed: ' + err.message);
    }
    setBusyId(null);
  };

  const pending = filtered.filter(a => !a.alreadyResolved);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Signup Credit Grants</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${pending.length} denied signup${pending.length !== 1 ? 's' : ''} awaiting review`}
          </p>
        </div>
        <button onClick={fetchDenied} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-sm font-medium">Base Signup Credit Amounts</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Applied to every new automatic grant. Owners who list a vehicle during onboarding still get 250cr deducted from the owner amount on top of whatever's set here.
        </p>
        <div className="flex flex-wrap items-end gap-4 mt-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Driver</label>
            <input
              type="number"
              min="0"
              step="1"
              disabled={baseCreditsLoading || savingBaseCredits}
              value={baseCreditsInput.driver}
              onChange={e => setBaseCreditsInput(prev => ({ ...prev, driver: e.target.value }))}
              className="w-28 border rounded-lg px-2 py-1.5 text-sm disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Owner (or Both)</label>
            <input
              type="number"
              min="0"
              step="1"
              disabled={baseCreditsLoading || savingBaseCredits}
              value={baseCreditsInput.owner}
              onChange={e => setBaseCreditsInput(prev => ({ ...prev, owner: e.target.value }))}
              className="w-28 border rounded-lg px-2 py-1.5 text-sm disabled:opacity-50"
            />
          </div>
          <button
            onClick={saveBaseCredits}
            disabled={baseCreditsLoading || savingBaseCredits}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {savingBaseCredits ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          placeholder="Search name, email, or IP…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 pr-3 py-2 w-full border rounded-lg text-sm bg-background"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : pending.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">
          No denied signups pending review.
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map(a => (
            <div key={a.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-sm">
                    {a.profile?.full_name || a.email || 'Unknown user'}
                    {!a.profile && (
                      <span className="ml-2 text-xs text-red-600 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> No profile found
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{a.profile?.email || a.email} · {a.profile?.customer_code}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    IP: {a.ip} · Type: {a.profile_type || a.profile?.account_type || '—'} · {new Date(a.created_at).toLocaleString('en-ZA')}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium shrink-0">
                  {REASON_LABELS[a.reason] || a.reason}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                <Coins className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  type="number"
                  value={amounts[a.user_id] ?? ''}
                  onChange={e => setAmounts(prev => ({ ...prev, [a.user_id]: parseInt(e.target.value) || 0 }))}
                  className="w-24 border rounded-lg px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-muted-foreground">credits</span>
                <button
                  onClick={() => grantCredits(a)}
                  disabled={busyId === a.user_id || !a.profile}
                  className="ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {busyId === a.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Grant Credits
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
