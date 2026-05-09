import React, { useState, useEffect } from 'react';
import { auth, supabase } from '@/api/supabaseData'; // supabase must be exported here
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowDownLeft, ArrowUpRight, Plus, Minus, Send } from 'lucide-react';
import { format } from 'date-fns';
import PageHeader from '@/components/layout/PageHeader';
import WalletCard from '@/components/dashboard/WalletCard';
import EmptyState from '@/components/common/EmptyState';
import PayModal from '@/components/wallet/PayModal';
import SubscriptionGate from '@/components/subscription/SubscriptionGate';
import { toast } from 'sonner';

export default function Wallet() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [depositModal, setDepositModal] = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [amount, setAmount] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {}).finally(() => setUserLoading(false));
  }, []);

  const { data: transactions = [], refetch: refetchTransactions } = useQuery({
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
      return data;
    },
    enabled: !!user?.id,
  });

  const handleDeposit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }

    setProcessing(true);
    try {
      // 1. Insert the transaction record
      const { error: insertError } = await supabase.from('transactions').insert([
        {
          from_user_id: null, // system deposit
          to_user_id: user.id,
          amount: amt,
          type: 'deposit',
          description: 'Funds added',
        },
      ]);
      if (insertError) throw insertError;

      // 2. Update wallet balance in user metadata
      const newBalance = (user.wallet_balance || 0) + amt;
      await auth.updateMe({ wallet_balance: newBalance });

      // 3. Refresh user data and transactions
      const updatedUser = await auth.me();
      setUser(updatedUser);
      refetchTransactions();

      toast.success(`R ${amt} deposited successfully!`);
      setDepositModal(false);
      setAmount('');
    } catch (err) {
      console.error('Deposit error:', err);
      toast.error(err.message || 'Deposit failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (amt > (user?.wallet_balance || 0)) { toast.error('Insufficient funds'); return; }

    setProcessing(true);
    try {
      const { error: insertError } = await supabase.from('transactions').insert([
        {
          from_user_id: user.id,
          to_user_id: null, // withdrawal
          amount: amt,
          type: 'withdrawal',
          description: 'Withdrawal to bank',
        },
      ]);
      if (insertError) throw insertError;

      const newBalance = (user.wallet_balance || 0) - amt;
      await auth.updateMe({ wallet_balance: newBalance });
      const updatedUser = await auth.me();
      setUser(updatedUser);
      refetchTransactions();

      toast.success(`R ${amt} withdrawn successfully!`);
      setWithdrawModal(false);
      setAmount('');
    } catch (err) {
      console.error('Withdraw error:', err);
      toast.error(err.message || 'Withdrawal failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Wallet" subtitle="Manage your funds" backTo="/" />
      <WalletCard balance={user?.wallet_balance || 0} />

      <SubscriptionGate user={user} loading={userLoading}>
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

        {transactions.length > 0 ? (
          <div className="space-y-2">
            {transactions.map(t => {
              const isReceived = t.to_user_id === user?.id && t.from_user_id !== user?.id;
              return (
                <Card key={t.id} className="p-4 border border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${isReceived ? 'bg-emerald-50' : 'bg-red-50'}`}>
                        {isReceived
                          ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                          : <ArrowUpRight className="w-4 h-4 text-red-500" />
                        }
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.created_at && format(new Date(t.created_at), 'MMM d, yyyy')}
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

      {/* Deposit Modal */}
      <Dialog open={depositModal} onOpenChange={setDepositModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Funds</DialogTitle></DialogHeader>
          <div>
            <Label>Amount (ZAR)</Label>
            <Input className="mt-1" type="number" placeholder="500" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositModal(false)}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={processing}>
              {processing ? 'Processing...' : 'Deposit'}
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
            <Button variant="outline" onClick={() => setWithdrawModal(false)}>Cancel</Button>
            <Button onClick={handleWithdraw} disabled={processing}>
              {processing ? 'Processing...' : 'Withdraw'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PayModal
        open={payModal}
        onClose={() => setPayModal(false)}
        user={user}
        onSuccess={async () => {
          const updated = await auth.me();
          setUser(updated);
        }}
      />
    </div>
  );
}
