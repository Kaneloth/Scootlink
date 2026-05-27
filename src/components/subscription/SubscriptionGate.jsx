import React from 'react';
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Wraps content that requires an active subscription.
 * Unsubscribed users see a prompt that links to the Settings Plan tab.
 */
export default function SubscriptionGate({ user, loading, children }) {
  if (loading) return null;

  if (!user?.subscription_active) {
    return (
      <Card className="p-6 border border-primary/20 bg-primary/5 flex flex-col items-center text-center gap-4 mt-6">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Crown className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Subscribe to unlock this feature</p>
          <p className="text-sm text-muted-foreground mt-1">Plans from R 39/month. Verify your identity and subscribe to get full access.</p>
        </div>
        <Link to="/settings?tab=plan">
          <Button className="gap-2">
            <Crown className="w-4 h-4" /> View Plans
          </Button>
        </Link>
      </Card>
    );
  }

  return children;
}
