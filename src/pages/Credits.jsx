import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, ArrowUpRight, ArrowDownLeft, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { useCredits } from '@/hooks/useCredits';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

const PACKAGES = [
  { id: 'starter',  label: 'Starter Pack',  price: 29,  credits: 10  },
  { id: 'standard', label: 'Standard Pack', price: 49,  credits: 30, popular: true },
  { id: 'pro',      label: 'Pro Pack',       price: 79,  credits: 60  },
  { id: 'business', label: 'Business Pack', price: 199, credits: 200 },
];

const CREDIT_COSTS = [
  { action: 'Start or reply to a new chat', cost: 3  },
  { action: 'List a vehicle',               cost: 10 },
  { action: 'Access rental agreement',      cost: 30 },
  { action: 'ID / licence verification',    cost: 30 },
];

export default function Credits() {
  const navigate              = useNavigate();
  const { balance, loading, refetch } = useCredits();
  const [ledger, setLedger]   = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);

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

      {/* What credits cost */}
      <Card className="p-4 border border-border/50 mb-6">
        <p className="text-sm font-semibold text-foreground mb-3">Credit costs</p>
        <div className="space-y-2">
          {CREDIT_COSTS.map(({ action, cost }) => (
            <div key={action} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{action}</span>
              <span className="font-semibold text-foreground">{cost} cr</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Packages */}
      <p className="text-sm font-semibold text-foreground mb-3">Buy credits</p>
      <div className="space-y-3 mb-8">
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
