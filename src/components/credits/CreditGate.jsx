/**
 * CreditGate — wraps content that requires a minimum credit balance.
 * Shows a buy-credits prompt when the user has insufficient credits.
 */
import React, { useState } from 'react';
import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useCredits } from '@/hooks/useCredits';

export default function CreditGate({ required = 1, children, message }) {
  const { balance, loading } = useCredits();
  const [showModal, setShowModal] = useState(false);

  if (loading) return null;

  if (balance < required) {
    return (
      <Card className="p-6 border border-primary/20 bg-primary/5 flex flex-col items-center text-center gap-4 mt-6">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Coins className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-foreground">
            {message || `You need ${required} credits to access this feature`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Your balance: <span className="font-semibold">{balance} credits</span>.
            Top up to continue.
          </p>
        </div>
        <Button onClick={() => setShowModal(true)} className="gap-2">
          <Coins className="w-4 h-4" /> Buy Credits
        </Button>

        {showModal && (
          <div
            className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
          >
            <div className="bg-background rounded-2xl w-full max-w-sm shadow-xl p-6 text-center space-y-3">
              <Coins className="w-10 h-10 text-primary mx-auto" />
              <p className="font-semibold">Purchase credits</p>
              <p className="text-sm text-muted-foreground">
                Tap the credit balance in the top bar to buy credits and continue.
              </p>
              <Button variant="outline" onClick={() => setShowModal(false)} className="w-full">
                Close
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return children;
}
