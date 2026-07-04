/**
 * CreditGate — wraps content that requires a minimum credit balance.
 *
 * By design, this never shows the person their balance, the required
 * amount, or the word "credits" — the internal currency stays invisible
 * during normal usage. If a feature is gated, we just say it needs
 * unlocking and route straight to the (fully transparent, real-price)
 * purchase page. The only place someone learns they're "running low" is
 * the 70%-usage notification, which is a deliberate, separate signal.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
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
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-foreground">
            {message || 'Unlock this feature to continue'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            You'll need to upgrade your account to keep using this.
          </p>
        </div>
        <Button onClick={() => navigate('/credits')} className="gap-2">
          <Sparkles className="w-4 h-4" /> Continue
        </Button>
      </Card>
    );
  }

  return children;
}
