import React, { useState, useEffect } from 'react';
import { auth, supabase } from '@/api/supabaseData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  const [payModal, setPayModal] = useState(false);

  // Fetch latest user (with up‑to‑date wallet_balance) whenever this page mounts
  useEffect(() => {
    auth.me().then(setUser).catch(() => {}).finally(() => setUserLoading(false));
  }, []);

  // Refresh user after a successful payment
  const handlePaymentSuccess = async () => {
    const updated = await auth.me();
    setUser(updated);
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

      // Fetch all involved profile names
      const ids = new Set();
      data.forEach(t => {
        if (t.from_user_id) ids.add(t.from_user_id);
        if (t.to_user_id) ids.add(t.to_user_id);
      });
      if (ids.size > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', Array.from(ids));
        const nameMap = {};
        (profiles || []).forEach(p => { nameMap[p.id] = p.full_name || p.email || 'User'; });
        // Attach counterparty name
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
      <WalletCard balance={user?.wallet_balance ?? 0} />

      <SubscriptionGate user={user} loading={userLoading}>
        <div className="grid grid-cols-3 gap-3 mt-6">
          <Button onClick={() => toast.info('Deposit feature coming soon')} className="gap-2 h-auto py-3 flex-col">
            <Plus className="w-5 h-5" />
            <span className="text-xs">Add Funds</span>
          </Button>
          <Button variant="outline" onClick={() => toast.info('Withdraw feature coming soon')} className="gap-2 h-auto py-3 flex-col">
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
          <div className="text-center py-8 text-muted-foreground">Loading transactions...</div>
        ) : transactions.length > 0 ? (
          <div className="space-y-2">
            {transactions.map(t => {
              const isReceived = t.to_user_id === user?.id;
              return (
                <Card key={t.id} className="p-4 border border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${isReceived ? 'bg-emerald-50' : 'bg-red-50'}`}>
                        {isReceived ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-500" />}
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

      <PayModal
        open={payModal}
        onClose={() => setPayModal(false)}
        user={user}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
