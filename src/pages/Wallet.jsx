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
import { ArrowDownLeft, ArrowUpRight, Plus, Minus, Send, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/layout/PageHeader';
import WalletCard from '@/components/dashboard/WalletCard';
import EmptyState from '@/components/common/EmptyState';
import PayModal from '@/components/wallet/PayModal';
import SubscriptionGate from '@/components/subscription/SubscriptionGate';
import { toast } from 'sonner';

// Skeleton for the action buttons row
function ActionButtonsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 mt-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  );
}

// Skeleton for individual transaction rows
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

export default function Wallet() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [payModal, setPayModal] = useState(false);
  const [depositModal, setDepositModal] = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [amount, setAmount] = useState('');

  const refreshUser = async () => {
    try {
      const updated = await auth.me();
      setUser(updated);
    } catch (_) {
      // ignore
    } finally {
      setUserLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const handlePaymentSuccess = async () => {
    await refreshUser();
  };

  const handleDeposit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setProcessing(true);
    try {
      const newBalance = (user.wallet_balance || 0) + amt;
      await supabase.from('profiles').update({ wallet_balance: newBalance }).eq('id', user.id);
      await auth.updateMe({ wallet_balance: newBalance });
      await supabase.from('transactions').insert([{
        from_user_id: null, to_user_id: user.id, amount: amt,
        type: 'deposit', description: 'Funds added', created_at: new Date().toISOString(),
      }]);
      toast.success(`R ${amt.toFixed(2)} deposited`);
      closeDialogs();
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) { toast.error('Deposit failed: ' + err.message); }
    finally { setProcessing(false); }
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (amt > (user.wallet_balance || 0)) { toast.error('Insufficient balance'); return; }
    setProcessing(true);
    try {
      const newBalance = (user.wallet_balance || 0) - amt;
      await supabase.from('profiles').update({ wallet_balance: newBalance }).eq('id', user.id);
      await auth.updateMe({ wallet_balance: newBalance });
      await supabase.from('transactions').insert([{
        from_user_id: user.id, to_user_id: null, amount: amt,
        type: 'withdraw', description: 'Withdrawal', created_at: new Date().toISOString(),
      }]);
      toast.success(`R ${amt.toFixed(2)} withdrawn`);
      closeDialogs();
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) { toast.error('Withdrawal failed: ' + err.message); }
    finally { setProcessing(false); }
  };

  const closeDialogs = () => {
    setDepositModal(false);
    setWithdrawModal(false);
    setAmount('');
    setProcessing(false);
  };

  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ['transactions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const ids = new Set();
      data.forEach(t => {
        if (t.from_user_id) ids.add(t.from_user_id);
        if (t.to_user_id) ids.add(t.to_user_id);
      });
      if (ids.size > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', Array.from(ids));
        const nameMap = {};
        (profiles || []).forEach(p => { nameMap[p.id] = p.full_name || p.email || 'User'; });
        return data.map(t => ({
          ...t,
          counterpartyName: t.to_user_id === user.id
            ? (nameMap[t.from_user_id] || 'Unknown')
            : (nameMap[t.to_user_id] || 'Unknown'),
        }));
      }
      return data.map(t => ({ ...t, counterpartyName: 'Unknown' }));
    },
    enabled: !!user?.id,
  });

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Wallet" subtitle="Manage your funds" backTo="/" />

      {/* Pass loading so WalletCard shows a skeleton instead of R 0.00 */}
      <WalletCard balance={user?.wallet_balance ?? 0} loading={userLoading} showTapHint={false} />

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
                const isReceived = t.to_user_id === user?.id;
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
                          <p className="text-sm font-medium">{isReceived ? `From: ${t.counterpartyName}` : `To: ${t.counterpartyName}`}</p>
                          <p className="text-xs text-muted-foreground">{t.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.created_at ? format(new Date(t.created_at), 'MMM d, yyyy') : ''}
                          </p>
                        </div>
                      </div>
                      <span className={`font-bold text-sm ${isReceived ? 'text-emerald-600' : 'text-red-500'}`}>
                        {isReceived ? '+' : '-'} R {t.amount}
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

      {/* Deposit Modal */}
      <Dialog open={depositModal} onOpenChange={setDepositModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Funds</DialogTitle></DialogHeader>
          <div>
            <Label>Amount (ZAR)</Label>
            <Input className="mt-1" type="number" placeholder="500" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialogs}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={processing}>
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Deposit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdraw Modal */}
      <Dialog open={withdrawModal} onOpenChange={setWithdrawModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Withdraw Funds</DialogTitle></DialogHeader>
          <div>
            <Label>Amount (ZAR)</Label>
            <Input className="mt-1" type="number" placeholder="500" value={amount} onChange={e => setAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Available: R {(user?.wallet_balance || 0).toFixed(2)}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialogs}>Cancel</Button>
            <Button onClick={handleWithdraw} disabled={processing}>
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PayModal
        open={payModal}
        onClose={() => setPayModal(false)}
        user={user}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
