/**
 * CreditBalance — shows the user's credit balance in the header.
 * Clicking it opens the purchase modal.
 */
import React, { useState, useEffect } from 'react';
import { Coins, X, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCredits } from '@/hooks/useCredits';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

// ── Credit packages (Skootlink pricing) ─────────────────────────────────────
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

export default function CreditBalance() {
  const { balance, loading, refetch } = useCredits();
  const [showModal, setShowModal]     = useState(false);

  // Handle PayFast return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('payment');
    if (!status) return;

    if (status === 'success') {
      toast.success('Payment received! Your credits will appear shortly.');
      refetch();
      const t = setTimeout(() => refetch(), 4000);
      return () => clearTimeout(t);
    } else if (status === 'cancelled') {
      toast.info('Payment cancelled — no credits were charged.');
    }

    params.delete('payment');
    const newUrl = window.location.pathname + (params.toString() ? `?${params}` : '');
    window.history.replaceState({}, '', newUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        onClick={() => {
          setShowModal(true);
          window.dispatchEvent(new Event('skootlink:credit-modal-open'));
        }}
        className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-semibold hover:bg-primary/20 transition-colors"
        title="Your credits — tap to buy more"
      >
        <Coins className="w-3.5 h-3.5" />
        {loading ? '…' : balance}
        <span className="font-normal text-xs opacity-70">cr</span>
      </button>

      {showModal && (
        <PurchaseModal
          balance={balance}
          loading={loading}
          onClose={() => {
            setShowModal(false);
            refetch();
            window.dispatchEvent(new Event('skootlink:credit-modal-close'));
          }}
        />
      )}
    </>
  );
}

// ── Purchase modal ────────────────────────────────────────────────────────────
function PurchaseModal({ balance, loading, onClose }) {
  const [purchasing,  setPurchasing]  = useState(null);
  const [selectedPkg, setSelectedPkg] = useState(
    PACKAGES.find(p => p.popular)?.id || PACKAGES[1].id
  );
  const [showCosts, setShowCosts] = useState(false);

  const handlePurchase = async () => {
    const pkg = PACKAGES.find(p => p.id === selectedPkg);
    if (!pkg) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error('Please sign in first.'); return; }
    setPurchasing(pkg.id);

    try {
      const res = await fetch('/.netlify/functions/payfast-initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ package_id: pkg.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');

      // Build a hidden form and POST to PayFast (their required method)
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
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ touchAction: 'none' }}
    >
      <div className="bg-background rounded-2xl w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-bold text-foreground">Buy Credits</h2>
          <button onClick={onClose} className="p-3 rounded-lg hover:bg-muted transition-colors -mr-1" style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' }}>
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Balance */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-primary/5 border border-primary/20">
            <div>
              <p className="text-xs text-muted-foreground">Your credit balance</p>
              {loading
                ? <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mt-1" />
                : <p className="text-3xl font-bold text-primary">{balance}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">credits · never expire</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Coins className="w-6 h-6 text-primary" />
            </div>
          </div>

          {/* Packages */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Choose a package</p>
            <div className="space-y-2.5">
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
          </div>

          {/* Pay button */}
          <Button onClick={handlePurchase} disabled={purchasing !== null} className="w-full h-12 text-base font-bold rounded-2xl gap-2">
            {purchasing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              : <>Pay R{selected?.price} — Get {selected?.credits.toLocaleString()} credits</>}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground -mt-3">
            Secure payment via card or EFT · Credits added instantly
          </p>

          {/* How far your credits go — collapsible */}
          <div className="border border-border rounded-2xl overflow-hidden">
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
        </div>
      </div>
    </div>
  );
}
