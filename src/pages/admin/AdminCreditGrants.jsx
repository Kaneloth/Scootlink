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

function creditsForType(profileType) {
  return (profileType === 'owner' || profileType === 'both') ? 1250 : 350;
}

export default function AdminCreditGrants() {
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [amounts, setAmounts] = useState({});

  const fetchDenied = async () => {
    setLoading(true);

    const { data: denied, error } = await supabase
      .from('signup_grant_attempts')
      .select('*')
      .eq('granted', 0)
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) {
      toast.error('Could not load denied grants: ' + error.message);
      setLoading(false);
      return;
    }

    // Keep only the most recent attempt per user — someone can trigger
    // several denied attempts (e.g. retrying signup), we only need one row.
    const latestByUser = new Map();
    for (const a of denied || []) {
      if (!a.user_id) continue;
      if (!latestByUser.has(a.user_id)) latestByUser.set(a.user_id, a);
    }
    const rows = [...latestByUser.values()];

    const userIds = rows.map(r => r.user_id);
    const [{ data: profiles }, { data: existingGrants }] = await Promise.all([
      userIds.length
        ? supabase.from('profiles').select('id, full_name, email, phone, account_type, customer_code').in('id', userIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('credit_ledger').select('user_id').eq('type', 'signup_bonus').in('user_id', userIds)
        : Promise.resolve({ data: [] }),
    ]);

    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));
    const alreadyGranted = new Set((existingGrants || []).map(g => g.user_id));

    const merged = rows.map(r => ({
      ...r,
      profile: profileMap[r.user_id] || null,
      alreadyResolved: alreadyGranted.has(r.user_id),
    }));

    setAttempts(merged);
    setAmounts(Object.fromEntries(merged.map(r => [r.user_id, creditsForType(r.profile_type)])));
    setLoading(false);
  };

  useEffect(() => { fetchDenied(); }, []);

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

    // Re-check right before granting — someone else on the team, or the
    // person themself via a later real signup retry, may have already
    // resolved this since the page loaded.
    const { data: dupe } = await supabase
      .from('credit_ledger')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'signup_bonus')
      .maybeSingle();
    if (dupe) {
      toast.error('Already granted — refreshing list.');
      setAttempts(prev => prev.map(a => a.user_id === userId ? { ...a, alreadyResolved: true } : a));
      setBusyId(null);
      return;
    }

    const amount = amounts[userId] || creditsForType(attempt.profile_type);

    // Written with type: 'signup_bonus' — identical to what
    // grant-signup-credits.js writes on a clean automatic grant, so this
    // is indistinguishable from a real signup bonus in the ledger.
    const { error: creditErr } = await supabase.rpc('add_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_type: 'signup_bonus',
      p_description: `Welcome bonus — ${amount} free credits`,
      p_ref_id: null,
    });

    if (creditErr) {
      toast.error('Grant failed: ' + creditErr.message);
      setBusyId(null);
      return;
    }

    // Backfill the same fraud-guard records a clean automatic grant would
    // have written, so future signup attempts on this email/phone are
    // still correctly blocked — otherwise this override would quietly
    // weaken the guards for next time.
    if (profile.email) {
      await supabase.from('email_grants').upsert(
        { email: profile.email.toLowerCase().trim(), user_id: userId, granted_at: new Date().toISOString() },
        { onConflict: 'email' }
      );
    }
    if (profile.phone) {
      const cleanPhone = profile.phone.replace(/\s+/g, '').replace(/[^+\d]/g, '');
      if (cleanPhone) {
        await supabase.from('phone_fingerprints').upsert(
          { phone: cleanPhone, user_id: userId, credit_granted: true },
          { onConflict: 'phone' }
        );
      }
    }

    setAttempts(prev => prev.map(a => a.user_id === userId ? { ...a, alreadyResolved: true } : a));
    toast.success(`Granted ${amount} credits to ${profile.full_name || profile.email}`);
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
