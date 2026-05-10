import React, { useState, useEffect } from 'react';
import { auth, supabase } from '@/api/supabaseData';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Send, Loader2, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PayModal({ open, onClose, user, onSuccess }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [step, setStep] = useState('select');
  const [counterparties, setCounterparties] = useState([]);
  const [fetching, setFetching] = useState(true);

  // Fetch counterparties when modal opens
  useEffect(() => {
    if (!user || !open) return;
    setFetching(true);
    setSelectedId('');
    setAmount('');
    setNote('');
    setStep('select');

    (async () => {
      try {
        const { data: rentals, error: rentalError } = await supabase
          .from('rentals')
          .select('*')
          .or(`owner_id.eq.${user.id},driver_id.eq.${user.id}`);

        if (rentalError) throw rentalError;

        const activeStatuses = ['active', 'awaiting_driver_confirmation'];
        const relevant = (rentals || []).filter(r => activeStatuses.includes(r.status));

        const otherIds = new Set();
        for (const r of relevant) {
          const otherId = r.owner_id === user.id ? r.driver_id : r.owner_id;
          if (otherId) otherIds.add(otherId);
        }

        const ids = Array.from(otherIds);
        if (ids.length === 0) {
          setCounterparties([]);
          setFetching(false);
          return;
        }

        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, email, verified, wallet_balance')
          .in('id', ids);

        if (profileError) throw profileError;

        setCounterparties(profiles || []);
      } catch (err) {
        console.error('PayModal fetch error:', err);
        toast.error('Could not load contacts');
      } finally {
        setFetching(false);
      }
    })();
  }, [user, open]);

  const selectedUser = counterparties.find(c => c.id === selectedId);

  const sendPayment = async () => {
    const amt = parseFloat(amount);
    if (!selectedId || !amt || amt <= 0) {
      toast.error('Invalid amount');
      return;
    }
    if (amt > (user?.wallet_balance || 0)) {
      toast.error('Insufficient balance');
      return;
    }

    try {
      // 1. Fetch current balances
      const [senderProfile, recipientProfile] = await Promise.all([
        supabase.from('profiles').select('wallet_balance').eq('id', user.id).single(),
        supabase.from('profiles').select('wallet_balance').eq('id', selectedId).single(),
      ]);

      const senderBalance = (user.wallet_balance || 0) - amt;
      const recipientBalance = (recipientProfile?.data?.wallet_balance || 0) + amt;

      // 2. Update sender's balance (via auth.updateMe for immediate UI) and also profiles table
      await Promise.all([
        auth.updateMe({ wallet_balance: senderBalance }),
        supabase.from('profiles').update({ wallet_balance: senderBalance }).eq('id', user.id),
      ]);

      // 3. Update recipient's balance in profiles table
      const { error: updateRecipientError } = await supabase
        .from('profiles')
        .update({ wallet_balance: recipientBalance })
        .eq('id', selectedId);
      if (updateRecipientError) throw updateRecipientError;

      // 4. Insert transaction record
      const { error: txError } = await supabase.from('transactions').insert([
        {
          from_user_id: user.id,
          to_user_id: selectedId,
          amount: amt,
          type: 'payment',
          description: note || `Payment to ${selectedUser?.full_name || 'User'}`,
          created_at: new Date().toISOString(),
        },
      ]);
      if (txError) throw txError;

      toast.success(`R ${amt.toFixed(2)} sent to ${selectedUser?.full_name || 'User'}`);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      if (onSuccess) onSuccess();
      handleClose();
    } catch (err) {
      toast.error('Payment failed: ' + err.message);
    }
  };

  const handleClose = () => {
    setSelectedId('');
    setAmount('');
    setNote('');
    setStep('select');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'select' ? 'Pay a Contact' : step === 'amount' ? 'Enter Amount' : 'Confirm Payment'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select recipient (dropdown) */}
        {step === 'select' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">You can only pay users you have an active contract with.</p>

            {fetching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : counterparties.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-4xl mb-2">🤝</p>
                <p className="text-sm font-medium">No contracted users found</p>
                <p className="text-xs mt-1">Active rentals will appear here</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Label>Select Recipient</Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a contracted user..." />
                  </SelectTrigger>
                  <SelectContent>
                    {counterparties.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name || c.email} ({c.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedUser && (
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                      {selectedUser.full_name?.[0] || '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{selectedUser.full_name || selectedUser.email}</p>
                        {selectedUser.verified && <ShieldCheck className="w-3.5 h-3.5 text-primary" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
                    </div>
                    {selectedId && <CheckCircle2 className="w-5 h-5 text-primary shrink-0 ml-auto" />}
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button disabled={!selectedId} onClick={() => setStep('amount')}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Amount */}
        {step === 'amount' && selectedUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                {selectedUser.full_name?.[0] || '?'}
              </div>
              <div>
                <p className="font-medium text-sm">{selectedUser.full_name || selectedUser.email}</p>
                <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
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
        {step === 'confirm' && selectedUser && (
          <div className="space-y-4">
            <div className="bg-muted rounded-2xl p-5 text-center">
              <p className="text-muted-foreground text-sm mb-1">Sending to</p>
              <p className="font-bold text-foreground">{selectedUser.full_name || selectedUser.email}</p>
              <p className="text-4xl font-extrabold text-primary mt-3">R {parseFloat(amount).toFixed(2)}</p>
              {note && <p className="text-xs text-muted-foreground mt-2">"{note}"</p>}
            </div>

            <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 flex items-start gap-2">
              <span>⚠️</span> Payments are instant and non-reversible. Please confirm the recipient and amount.
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('amount')}>Edit</Button>
              <Button
                onClick={() => sendPayment()}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Confirm & Send
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
