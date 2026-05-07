import React, { useState, useEffect } from 'react';
import { auth, Rental, Transaction, User } from '@/api/supabaseData';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, CheckCircle2, Send, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function PayModal({ open, onClose, user, onSuccess }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [step, setStep] = useState('select'); // 'select' | 'amount' | 'confirm'

  // Load all active rentals to determine contracted parties
  const { data: rentals = [] } = useQuery({
    queryKey: ['my-rentals-for-pay'],
    queryFn: async () => {
      const all = await Rental.list();
      return all.filter(r =>
        (r.owner_email === user?.email || r.driver_email === user?.email) &&
        (r.status === 'active' || r.status === 'pending')
      );
    },
    enabled: !!user?.email && open,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users-for-pay'],
    queryFn: () => User.list(),
    enabled: open,
  });

  // Derive contracted party emails
  const contractedEmails = new Set(
    rentals.flatMap(r => [r.owner_email, r.driver_email]).filter(e => e !== user?.email)
  );

  const contractedUsers = allUsers.filter(u =>
    contractedEmails.has(u.email) &&
    (u.full_name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()))
  );

  const sendPayment = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (!selected || !amt || amt <= 0) throw new Error('Invalid');
      if (amt > (user?.wallet_balance || 0)) throw new Error('Insufficient funds');

      await Transaction.create({
        from_email: user.email,
        to_email: selected.email,
        amount: amt,
        transaction_type: 'payment',
        description: note || `Payment to ${selected.full_name || selected.email}`,
      });

      await auth.updateMe({ wallet_balance: (user.wallet_balance || 0) - amt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success(`R ${amount} sent to ${selected?.full_name || selected?.email}`);
      onSuccess?.();
      handleClose();
    },
    onError: (err) => {
      toast.error(err.message === 'Insufficient funds' ? 'Insufficient wallet balance' : 'Payment failed');
    },
  });

  const handleClose = () => {
    setSearch('');
    setSelected(null);
    setAmount('');
    setNote('');
    setStep('select');
    onClose();
  };

  const rental = selected ? rentals.find(r =>
    r.owner_email === selected.email || r.driver_email === selected.email
  ) : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'select' ? 'Pay a Contact' : step === 'amount' ? 'Enter Amount' : 'Confirm Payment'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select recipient */}
        {step === 'select' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">You can only pay users you have an active contract with.</p>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {contractedUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-4xl mb-2">🤝</p>
                <p className="text-sm font-medium">No contracted users found</p>
                <p className="text-xs mt-1">You can only pay people you have an active rental with</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {contractedUsers.map(u => {
                  const r = rentals.find(rn => rn.owner_email === u.email || rn.driver_email === u.email);
                  const role = r?.owner_email === u.email ? 'Owner' : 'Driver';
                  return (
                    <button
                      key={u.id}
                      onClick={() => setSelected(u)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                        selected?.id === u.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0">
                        {u.full_name?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{u.full_name || u.email}</p>
                          {u.verified && <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          <Badge variant="outline" className="text-[9px] shrink-0">{role}</Badge>
                        </div>
                      </div>
                      {selected?.id === u.id && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button disabled={!selected} onClick={() => setStep('amount')}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Amount */}
        {step === 'amount' && selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                {selected.full_name?.[0] || '?'}
              </div>
              <div>
                <p className="font-medium text-sm">{selected.full_name || selected.email}</p>
                <p className="text-xs text-muted-foreground">{selected.email}</p>
              </div>
            </div>

            <div>
              <Label>Amount (ZAR) *</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">R</span>
                <Input
                  className="pl-7 text-lg font-bold"
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Available: R {(user?.wallet_balance || 0).toFixed(2)}</p>
            </div>

            <div>
              <Label>Note (optional)</Label>
              <Input className="mt-1" placeholder="Weekly rental payment..." value={note} onChange={e => setNote(e.target.value)} />
            </div>

            {rental && (
              <div className="bg-primary/5 p-3 rounded-xl text-xs text-muted-foreground">
                📋 Rental: {rental.start_date} – {rental.end_date} · R {rental.price_per_week}/week
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('select')}>Back</Button>
              <Button
                disabled={!amount || parseFloat(amount) <= 0}
                onClick={() => setStep('confirm')}
              >
                Review Payment
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 'confirm' && selected && (
          <div className="space-y-4">
            <div className="bg-muted rounded-2xl p-5 text-center">
              <p className="text-muted-foreground text-sm mb-1">Sending to</p>
              <p className="font-bold text-foreground">{selected.full_name || selected.email}</p>
              <p className="text-4xl font-extrabold text-primary mt-3">R {parseFloat(amount).toFixed(2)}</p>
              {note && <p className="text-xs text-muted-foreground mt-2">"{note}"</p>}
            </div>

            <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
              <span>⚠️</span> Payments are instant and non-reversible. Please confirm the recipient and amount.
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('amount')}>Edit</Button>
              <Button
                onClick={() => sendPayment.mutate()}
                disabled={sendPayment.isPending}
                className="gap-2"
              >
                {sendPayment.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sendPayment.isPending ? 'Sending...' : 'Confirm & Send'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}