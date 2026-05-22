import React, { useState, useEffect } from 'react';
import { auth, supabase } from '@/api/supabaseData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ArrowDownLeft, ArrowUpRight, Plus, Minus, Send, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/layout/PageHeader';
import WalletCard from '@/components/dashboard/WalletCard';
import EmptyState from '@/components/common/EmptyState';
import PayModal from '@/components/wallet/PayModal';
import SubscriptionGate from '@/components/subscription/SubscriptionGate';
import { toast } from 'sonner';
import { sendSMS } from '@/lib/sms';

// ── South African banks supported by Paystack ─────────────────────────────────
const SA_BANKS = [
  { name: 'ABSA',          code: '632005' },
  { name: 'Capitec Bank',  code: '470010' },
  { name: 'FNB',           code: '250655' },
  { name: 'Nedbank',       code: '198765' },
  { name: 'Standard Bank', code: '051001' },
  { name: 'TymeBank',      code: '678910' },
  { name: 'African Bank',  code: '430000' },
  { name: 'Bidvest Bank',  code: '462005' },
  { name: 'Discovery Bank',code: '679000' },
];

// ── Skeleton components ───────────────────────────────────────────────────────
function ActionButtonsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 mt-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  );
}

function TransactionSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="p-4 rounded-xl border border-border/50 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
            <div className="h-4 bg-muted rounded w-16 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Paystack inline script loader ─────────────────────────────────────────────
function loadPaystackScript() {
  return new Promise((resolve) => {
    if (window.PaystackPop) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Wallet() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [payModal, setPayModal] = useState(false);
  const [depositModal, setDepositModal] = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Deposit fields
  const [depositAmount, setDepositAmount] = useState('');

  // Withdraw fields
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');

  // authUserId is the Supabase Auth UUID — used for all wallet/RPC operations.
  // user.id may be a numeric profile PK; authUserId is always the real UUID.
  const [authUserId, setAuthUserId] = useState(null);

  const refreshUser = async () => {
    try {
      const [updated, { data: authData }] = await Promise.all([
        auth.me(),
        supabase.auth.getUser(),
      ]);
      setUser(updated);
      setAuthUserId(authData?.user?.id ?? null);
    } catch (_) {
      // ignore
    } finally {
      setUserLoading(false);
    }
  };

  useEffect(() => { refreshUser(); }, []);

  // ── Wallet balance from wallets table (source of truth, in cents) ───────────
  const { data: walletRow, refetch: refetchWallet } = useQuery({
    queryKey: ['wallet-balance', authUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', authUserId)
        .maybeSingle();
      return data;
    },
    enabled: !!authUserId,
  });

  // Balance in ZAR (wallets table stores cents)
  const walletBalanceZar = walletRow ? walletRow.balance / 100 : (user?.wallet_balance ?? 0);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['wallet-balance', authUserId] });
    queryClient.invalidateQueries({ queryKey: ['transactions', authUserId] });
  };

  // ── Add Funds via Paystack popup ─────────────────────────────────────────────
  const handleDeposit = async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt < 10) { toast.error('Minimum top-up is R 10'); return; }
    if (!user?.email)     { toast.error('User email not found'); return; }

    setProcessing(true);
    try {
      // 1. Initialize transaction server-side
      const initRes = await fetch('/.netlify/functions/paystack-initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_zar: amt, email: user.email, user_id: authUserId }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || 'Could not start payment');

      // 2. Load Paystack script and open popup
      await loadPaystackScript();
      setProcessing(false);
      setDepositModal(false);
      setDepositAmount('');

      const handler = window.PaystackPop.setup({
        key:           import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
        email:         user.email,
        amount:        Math.round(amt * 100),
        currency:      'ZAR',
        access_code:   initData.access_code,
        ref:           initData.reference,
        onSuccess: () => {
          toast.success('Payment received! Your wallet will be credited within a few seconds.');
          // Poll for balance update — webhook credits the wallet asynchronously
          setTimeout(() => { refetchWallet(); invalidateAll(); }, 4000);
          setTimeout(() => { refetchWallet(); invalidateAll(); }, 10000);
          try {
            if (user?.phone) {
              sendSMS(user.phone, `Your Skootlink wallet top-up of R ${amt.toFixed(2)} was successful.`);
            }
          } catch { /* non-critical */ }
        },
        onCancel: () => {
          toast.info('Payment cancelled.');
        },
      });
      handler.openIframe();
    } catch (err) {
      toast.error('Payment failed: ' + err.message);
      setProcessing(false);
    }
  };

  // ── Withdraw to bank account ──────────────────────────────────────────────────
  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt < 10)           { toast.error('Minimum withdrawal is R 10'); return; }
    if (amt > walletBalanceZar)     { toast.error('Insufficient wallet balance'); return; }
    if (!bankCode)                  { toast.error('Please select a bank'); return; }
    if (!accountNumber.trim())      { toast.error('Please enter your account number'); return; }
    if (!accountName.trim())        { toast.error('Please enter the account holder name'); return; }

    setProcessing(true);
    try {
      const res = await fetch('/.netlify/functions/paystack-withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:        authUserId,
          amount_zar:     amt,
          bank_code:      bankCode,
          account_number: accountNumber.trim(),
          account_name:   accountName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal request failed');

      toast.success(`Withdrawal of R ${amt.toFixed(2)} submitted. Funds will arrive in 1–2 business days.`);
      closeDialogs();
      refetchWallet();
      invalidateAll();
      try {
        if (user?.phone) {
          sendSMS(user.phone, `Your Skootlink withdrawal of R ${amt.toFixed(2)} has been submitted and will arrive in 1–2 business days.`);
        }
      } catch { /* non-critical */ }
    } catch (err) {
      toast.error('Withdrawal failed: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const closeDialogs = () => {
    setDepositModal(false);
    setWithdrawModal(false);
    setDepositAmount('');
    setWithdrawAmount('');
    setBankCode('');
    setAccountNumber('');
    setAccountName('');
    setProcessing(false);
  };

  const handlePaymentSuccess = async () => {
    await refreshUser();
    refetchWallet();
    invalidateAll();
  };

  // ── Transactions query ────────────────────────────────────────────────────────
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ['transactions', authUserId],
    queryFn: async () => {
      if (!authUserId) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .or(`from_user_id.eq.${authUserId},to_user_id.eq.${authUserId}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = new Set();
      data.forEach(t => {
        if (t.from_user_id) ids.add(t.from_user_id);
        if (t.to_user_id)   ids.add(t.to_user_id);
      });
      if (ids.size > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', Array.from(ids));
        const nameMap = {};
        (profiles || []).forEach(p => { nameMap[p.id] = p.full_name || p.email || 'User'; });
        return data.map(t => ({
          ...t,
          counterpartyName: t.to_user_id === authUserId
            ? (nameMap[t.from_user_id] || 'Unknown')
            : (nameMap[t.to_user_id]   || 'Unknown'),
        }));
      }
      return data.map(t => ({ ...t, counterpartyName: 'Unknown' }));
    },
    enabled: !!authUserId,
  });

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Wallet" subtitle="Manage your funds" backTo="/" />

      <WalletCard balance={walletBalanceZar} loading={userLoading} showTapHint={false} />

      {userLoading ? (
        <ActionButtonsSkeleton />
      ) : (
        <SubscriptionGate user={user} loading={false}>
          <div className="grid grid-cols-3 gap-3 mt-6">
            <Button onClick={() => setDepositModal(true)} className="gap-2 h-auto py-3 flex-col">
              <Plus className="w-5 h-5" />
              <span className="text-xs">Add Funds</span>
            </Button>
            <Button variant="outline" onClick={() => setWithdrawModal(true)} className="gap-2 h-auto py-3 flex-col">
              <Minus className="w-5 h-5" />
              <span className="text-xs">Withdraw</span>
            </Button>
            <Button variant="outline" className="gap-2 h-auto py-3 flex-col" onClick={() => setPayModal(true)}>
              <Send className="w-5 h-5" />
              <span className="text-xs">Pay</span>
            </Button>
          </div>

          <h3 className="text-lg font-semibold mt-8 mb-3">Recent Transactions</h3>

          {txLoading ? (
            <TransactionSkeleton />
          ) : transactions.length > 0 ? (
            <div className="space-y-2">
              {transactions.map(t => {
                const isReceived = t.to_user_id === authUserId;
                // Amount is stored in cents — display in ZAR
                const displayAmt = (parseFloat(t.amount) / 100).toFixed(2);
                const typeLabel = t.type === 'top_up' ? 'Top-up' : t.type === 'withdrawal' ? 'Withdrawal' : 'Transfer';
                return (
                  <Card key={t.id} className="p-4 border border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${isReceived ? 'bg-emerald-50' : 'bg-red-50'}`}>
                          {isReceived
                            ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                            : <ArrowUpRight className="w-4 h-4 text-red-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {isReceived ? `From: ${t.counterpartyName}` : `To: ${t.counterpartyName}`}
                          </p>
                          <p className="text-xs text-muted-foreground">{typeLabel}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.created_at ? format(new Date(t.created_at), 'MMM d, yyyy') : ''}
                            {t.status && t.status !== 'completed' && (
                              <span className={`ml-2 font-medium ${t.status === 'pending' ? 'text-amber-500' : 'text-red-500'}`}>
                                · {t.status}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <span className={`font-bold text-sm whitespace-nowrap shrink-0 ml-3 ${isReceived ? 'text-emerald-600' : 'text-red-500'}`}>
                        {isReceived ? '+' : '-'} R {displayAmt}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState icon="💳" title="No transactions yet" description="Your transaction history will appear here" />
          )}
        </SubscriptionGate>
      )}

      {/* ── Add Funds Modal ── */}
      <Dialog open={depositModal} onOpenChange={setDepositModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Funds</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount (ZAR)</Label>
              <Input
                className="mt-1"
                type="number"
                min="10"
                placeholder="500"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Minimum R 10. Pay securely via card or EFT.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialogs} disabled={processing}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={processing}>
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Pay with Paystack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Withdraw Modal ── */}
      <Dialog open={withdrawModal} onOpenChange={setWithdrawModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Withdraw to Bank Account</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount (ZAR)</Label>
              <Input
                className="mt-1"
                type="number"
                min="10"
                placeholder="500"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Available: R {walletBalanceZar.toFixed(2)} · Minimum R 10
              </p>
            </div>
            <div>
              <Label>Bank</Label>
              <Select value={bankCode} onValueChange={setBankCode}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select your bank" />
                </SelectTrigger>
                <SelectContent>
                  {SA_BANKS.map(b => (
                    <SelectItem key={b.code} value={b.code}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Account Number</Label>
              <Input
                className="mt-1"
                placeholder="e.g. 1234567890"
                value={accountNumber}
                onChange={e => setAccountNumber(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <div>
              <Label>Account Holder Name</Label>
              <Input
                className="mt-1"
                placeholder="Name as it appears on the account"
                value={accountName}
                onChange={e => setAccountName(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Funds typically arrive within 1–2 business days.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialogs} disabled={processing}>Cancel</Button>
            <Button onClick={handleWithdraw} disabled={processing}>
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Request Withdrawal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PayModal
        open={payModal}
        onClose={() => setPayModal(false)}
        user={user}
        walletBalance={walletBalanceZar}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
