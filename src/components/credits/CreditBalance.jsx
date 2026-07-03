/**
 * CreditBalance — shows the user's credit balance in the header.
 * Clicking it opens the purchase modal.
 */
import React, { useState, useEffect } from 'react';
import { Coins, X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCredits } from '@/hooks/useCredits';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

// ── Credit packages (Skootlink pricing) ─────────────────────────────────────
const PACKAGES = [
  { id: 'starter',  label: 'Starter Pack',  price: 39,  credits: 15  },
  { id: 'standard', label: 'Standard Pack', price: 59,  credits: 30, popular: true },
  { id: 'pro',      label: 'Pro Pack',      price: 99,  credits: 60  },
  { id: 'business', label: 'Business Pack', price: 199, credits: 200 },
];

// ── Credit costs reference ────────────────────────────────────────────────────
const CREDIT_COSTS = [
  { action: 'Start or reply to a new chat', cost: 3 },
  { action: 'List a vehicle',               cost: 10 },
  { action: 'Access rental agreement',      cost: 15 },
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
  const [purchasing, setPurchasing] = useState(null);

  const handlePurchase = async (pkg) => {
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

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ touchAction: 'none' }}
    >
      <div className="bg-background rounded-2xl w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="font-bold text-foreground">Buy Credits</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Balance: <span className="font-semibold text-primary">{balance} credits</span>
            </p>
          </div>
          <button onClick={onClose} className="p-3 rounded-lg hover:bg-muted transition-colors -mr-1" style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation' }}>
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Packages */}
        <div className="p-4 space-y-3">
          {PACKAGES.map(pkg => (
            <button
              key={pkg.id}
              onClick={() => handlePurchase(pkg)}
              disabled={purchasing !== null}
              className={`w-full text-left rounded-2xl border p-4 transition-all hover:border-primary hover:shadow-sm disabled:opacity-60 ${
                pkg.popular ? 'border-primary bg-primary/5' : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground">{pkg.label}</p>
                    {pkg.popular && (
                      <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                        POPULAR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{pkg.credits} credits</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="font-bold text-foreground">R{pkg.price}</p>
                  {purchasing === pkg.id
                    ? <Loader2 className="w-4 h-4 animate-spin text-primary ml-auto mt-1" />
                    : <p className="text-[10px] text-muted-foreground">
                        R{(pkg.price / pkg.credits).toFixed(2)}/cr
                      </p>
                  }
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Credit costs reference */}
        <div className="px-4 pb-4">
          <div className="bg-muted rounded-xl px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold text-foreground mb-2">What credits cost:</p>
            {CREDIT_COSTS.map(({ action, cost }) => (
              <p key={action} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Check className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                {action} = <span className="font-semibold text-foreground">{cost} cr</span>
              </p>
            ))}
            <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-1 border-t border-border mt-1">
              <Check className="w-3 h-3 text-primary shrink-0 mt-0.5" />
              Credits never expire
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
