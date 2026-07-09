import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Coins, ArrowUpRight, ArrowDownLeft, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { useCredits } from '@/hooks/useCredits';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

const PACKAGES = [
  { id: 'starter',  label: 'Starter Pack',  price: 49,  credits: 240  },
  { id: 'standard', label: 'Standard Pack', price: 79,  credits: 400, popular: true },
  { id: 'pro',      label: 'Pro Pack',      price: 129, credits: 660  },
  { id: 'business', label: 'Business Pack', price: 199, credits: 1040 },
];

// ── How far your credits go ─────────────────────────────────────────────────
const CREDIT_COSTS = [
  { icon: '💬', action: 'Start a chat',              cost: '50 credits'  },
  { icon: '🚗', action: 'List a vehicle (1st)',       cost: '250 credits' },
  { icon: '🚗', action: 'List a vehicle (2nd)',       cost: '200 credits' },
  { icon: '🚗', action: 'List a vehicle (3rd+)',      cost: '175 credits' },
  { icon: '📝', action: 'Sign a rental contract',     cost: '200 credits' },
];

export default function Credits() {
  const navigate              = useNavigate();
  const { balance, loading, refetch } = useCredits();
  const [ledger, setLedger]   = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);
  const [selectedPkg, setSelectedPkg] = useState(
    PACKAGES.find(p => p.popular)?.id || PACKAGES[1].id
  );
  const [showCosts, setShowCosts] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from('credit_ledger')
        .select('id, amount, type, description, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      setLedger(data || []);
      setLedgerLoading(false);
    });
  }, []);

  // Native: PayFast returns via co.za.skootlink.app://payment-result, which
  // App.jsx's appUrlOpen listener stashes here rather than as a URL query
  // Runs the moment the native Custom Tab closes (success or cancelled) —
  // not just on mount, since this page never actually unmounts while the
  // tab is open, so a mount-only check would already have run and finished
  // long before the payment even completed.
  const checkPaymentResult = React.useCallback(() => {
    setPurchasing(null);
    const raw = sessionStorage.getItem('skootlink_payment_result');
    if (!raw) return;
    sessionStorage.removeItem('skootlink_payment_result');
    let result;
    try { result = JSON.parse(raw); } catch { return; }
    if (result.category !== 'credits') return; // not ours — e.g. a verification payment

    if (result.status === 'success') {
      toast.success('Payment received! Your credits have been added.');
      refetch();
      // credit_ledger insert happens via the webhook, which can land a beat
      // after the redirect — refresh the visible history shortly after too.
      setTimeout(() => {
        supabase.auth.getUser().then(async ({ data: { user } }) => {
          if (!user) return;
          const { data } = await supabase
            .from('credit_ledger')
            .select('id, amount, type, description, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50);
          setLedger(data || []);
        });
      }, 2000);
    } else if (result.status === 'cancelled') {
      toast.info('Payment cancelled.');
    }
  }, [refetch]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Also check once on mount — covers the case where the app process was
    // killed while the Custom Tab was open and got relaunched fresh.
    checkPaymentResult();
    let listener;
    (async () => {
      try {
        const { Browser } = await import('@capacitor/browser');
        listener = await Browser.addListener('browserFinished', checkPaymentResult);
      } catch { /* not in Capacitor environment */ }
    })();
    return () => { if (listener) listener.remove().catch(() => {}); };
  }, [checkPaymentResult]);

  // Web only: PayFast's own https:// return_url lands here with a query
  // param instead — native never takes this path (see above).
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('payment');
    if (status === 'success') {
      toast.success('Payment received! Your credits have been added.');
      refetch();
    } else if (status === 'cancelled') {
      toast.info('Payment cancelled.');
    }
    if (status) {
      params.delete('payment');
      const newUrl = window.location.pathname + (params.toString() ? `?${params}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  const handlePurchase = async () => {
    const pkg = PACKAGES.find(p => p.id === selectedPkg);
    if (!pkg) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error('Please sign in first.'); return; }
    setPurchasing(pkg.id);

    const isNative = Capacitor.isNativePlatform();

    try {
      const res = await fetch('https://skootlink.co.za/.netlify/functions/payfast-initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ package_id: pkg.id, is_native: isNative }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');

      if (isNative) {
        const qs = new URLSearchParams(data.fields).toString();
        const fullUrl = `${data.action_url}?${qs}`;
        console.log('[Credits] Opening native payment Custom Tab:', fullUrl);
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: fullUrl, presentationStyle: 'popover' });
        return;
      }

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = data.action_url;
      Object.entries(data.fields).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type  = 'hidden';
        input.name  = key;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      toast.error(err.message || 'Could not start payment. Please try again.');
      setPurchasing(null);
    }
  };

  const selected = PACKAGES.find(p => p.id === selectedPkg);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-24">
      <PageHeader title="Credits" subtitle="Buy and manage your Skootlink credits" backTo="/home" />

      {/* Balance card */}
      <Card className="p-6 border border-primary/20 bg-primary/5 mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Your balance</p>
          {loading
            ? <Loader2 className="w-6 h-6 animate-spin text-primary mt-1" />
            : <p className="text-4xl font-bold text-primary">{balance}</p>
          }
          <p className="text-xs text-muted-foreground mt-1">credits · never expire</p>
        </div>
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Coins className="w-7 h-7 text-primary" />
        </div>
      </Card>

      {/* Packages */}
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Choose a package</p>
      <div className="space-y-2.5 mb-5">
        {PACKAGES.map(pkg => {
          const isSelected = selectedPkg === pkg.id;
          return (
            <button
              key={pkg.id}
              onClick={() => setSelectedPkg(pkg.id)}
              disabled={purchasing !== null}
              className={`w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all disabled:opacity-60 ${
                isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-primary' : 'border-muted-foreground/40'}`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xl font-extrabold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                      {pkg.credits.toLocaleString()}
                    </span>
                    <span className="text-sm text-muted-foreground font-medium">credits</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {pkg.popular && (
                    <span className="text-[10px] font-bold bg-primary text-white px-2 py-0.5 rounded-full">🔥 POPULAR</span>
                  )}
                  <span className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-foreground'}`}>R{pkg.price}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Pay button */}
      <Button onClick={handlePurchase} disabled={purchasing !== null} className="w-full h-12 text-base font-bold rounded-2xl gap-2 mb-2">
        {purchasing
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
          : <>Pay R{selected?.price} — Get {selected?.credits.toLocaleString()} credits</>}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground mb-6">
        Secure payment via card or EFT · Credits added instantly
      </p>

      {/* How far your credits go — collapsible */}
      <div className="border border-border rounded-2xl overflow-hidden mb-8">
        <button onClick={() => setShowCosts(v => !v)} className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-muted/40 transition-colors">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How far your credits go</p>
          {showCosts ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showCosts && (
          <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
            {CREDIT_COSTS.map(({ icon, action, cost }) => (
              <div key={action} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{icon}</span>
                  <p className="text-xs text-muted-foreground">{action}</p>
                </div>
                <span className="text-xs font-semibold text-foreground shrink-0 ml-2">{cost}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-border">
              <p className="text-[11px] text-muted-foreground text-center">Credits never expire · Sign-up bonus included</p>
            </div>
          </div>
        )}
      </div>

      {/* Transaction history */}
      <p className="text-sm font-semibold text-foreground mb-3">Transaction history</p>
      {ledgerLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : ledger.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No transactions yet.</p>
      ) : (
        <div className="space-y-2">
          {ledger.map(entry => (
            <Card key={entry.id} className="p-3 border border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  entry.amount > 0 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'
                }`}>
                  {entry.amount > 0
                    ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                    : <ArrowUpRight  className="w-4 h-4 text-red-500" />
                  }
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{entry.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleDateString('en-ZA', {
                      day: 'numeric', month: 'short', year: 'numeric'
                    })}
                  </p>
                </div>
              </div>
              <p className={`font-bold text-sm ${entry.amount > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {entry.amount > 0 ? '+' : ''}{entry.amount} cr
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
