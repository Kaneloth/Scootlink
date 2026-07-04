/**
 * CreditGate — wraps content that requires a minimum credit balance.
 * Unlike a click-triggered action (which uses InsufficientCreditsModal),
 * this gates a whole page section, so it renders an inline card rather
 * than a popup — but states the exact amount needed, same as everywhere
 * else in the app.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useCredits } from '@/hooks/useCredits';

export default function CreditGate({ required = 1, children, message }) {
  const { balance, loading } = useCredits();
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    import('@/api/supabaseClient').then(({ supabase }) => {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user?.user_metadata?.is_admin) setIsAdmin(true);
      });
    });
  }, []);

  if (loading) return null;

  // Admins bypass all gates
  if (isAdmin) return children;

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
            Top up your credits to continue.
          </p>
        </div>
        <Button onClick={() => navigate('/credits')} className="gap-2">
          <Coins className="w-4 h-4" /> View Credit Packages
        </Button>
      </Card>
    );
  }

  return children;
}
