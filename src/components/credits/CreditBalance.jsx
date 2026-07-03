/**
 * CreditBalance — shows the user's credit balance in the header.
 * Clicking it opens the purchase modal.
 * 
 * Psychology: Packages first (generosity), costs second (enablement)
 */
import React, { useState, useEffect } from 'react';
import { Coins, X, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCredits } from '@/hooks/useCredits';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

// ── Credit packages ───────────────────────────────────────────────────────────
const PACKAGES = [
  { id: 'starter',  credits: 240,   price: 49  },
  { id: 'standard', credits: 400,   price: 79,  popular: true },
  { id: 'pro',      credits: 660,   price: 129 },
  { id: 'business', credits: 1040,  price: 199 },
];

// ── Credit costs reference (shown collapsed at bottom) ────────────────────────
const CREDIT_COSTS = [
  { icon: '💬', action: 'Start a new chat',        cost: '3 credits' },
  { icon: '🚗', action: 'List a vehicle (1st)',     cost: '30 credits' },
  { icon: '🚗', action: 'List a vehicle (2nd)',     cost: '25 credits' },
  { icon: '🚗', action: 'List a vehicle (3rd+)',    cost: '20 credits' },
  { icon: '📝', action: 'Access rental agreement', cost: '15 credits' },
  { icon: '🛡️', action: 'Verified badge',          cost: 'R50 once-off' },
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
function PurchaseModal({ balance, onClose }) {
  const [purchasing,   setPurchasing]   = useState(null);
  const [showCosts,    setShowCosts]    = useState(false);
  const [selectedPkg,  setSelectedPkg]  = useState(
    PACKAGES.find(p => p.popular)?.id || PACKAGES[1].id
  );

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

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="font-bold text-lg text-foreground">Top Up Credits</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Coins className="w-3.5 h-3.5 text-primary" />
              <p className="text-sm text-muted-foreground">
                Balance: <span className="font-bold text-primary">{balance} credits</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl hover:bg-muted transition-colors"
            style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="h-px bg-border mx-5" />

        {/* ── Packages ── */}
        <div className="px-5 pt-4 pb-2">
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
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Radio indicator */}
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? 'border-primary' : 'border-muted-foreground/40'
                      }`}>
                        {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                      <div>
                        {/* Big credit number is the hero */}
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-xl font-extrabold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                            {pkg.credits.toLocaleString()}
                          </span>
                          <span className="text-sm text-muted-foreground font-medium">credits</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-2">
                        {pkg.popular && (
                          <span className="text-[10px] font-bold bg-primary text-white px-2 py-0.5 rounded-full">
                            🔥 POPULAR
                          </span>
                        )}
                        <span className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                          R{pkg.price}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Pay button ── */}
        <div className="px-5 pt-3 pb-2">
          <Button
            onClick={handlePurchase}
            disabled={purchasing !== null}
            className="w-full h-12 text-base font-bold rounded-2xl gap-2"
          >
            {purchasing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              : <>Pay R{selected?.price} — Get {selected?.credits.toLocaleString()} credits</>
            }
          </Button>
          <p className="text-center text-[11px] text-muted-foreground mt-2">
            Secure payment via card or EFT · Credits added instantly
          </p>
        </div>

        <div className="h-px bg-border mx-5 mt-2" />

        {/* ── How far your credits go (collapsible) ── */}
        <div className="px-5 py-3">
          <button
            onClick={() => setShowCosts(v => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              How far your credits go
            </p>
            {showCosts
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>

          {showCosts && (
            <div className="mt-3 space-y-2">
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
                <p className="text-[11px] text-muted-foreground text-center">
                  Credits never expire · Sign-up bonus included
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
