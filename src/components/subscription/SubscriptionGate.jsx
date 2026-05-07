import React from 'react';
import { Link } from 'react-router-dom';
import { Crown, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SubscriptionGate({ user, children, loading = false }) {
  const isActive = user?.subscription_active === true;

  // Don't flash the gate while user is still loading
  if (loading || user === null) return null;

  if (!isActive) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-5">
          <Crown className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Subscription Required</h2>
        <p className="text-sm text-muted-foreground max-w-xs mb-6">
          You need an active Scootlink subscription to access this feature. Plans start from R 49/month. Driver · Owner · Fleet Pro.
        </p>
        <Link to="/subscription">
          <Button className="gap-2 px-6">
            <Crown className="w-4 h-4" />
            View Plans & Subscribe
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground mt-4">New to Scootlink? <Link to="/onboarding" className="text-primary underline">Complete your profile first</Link></p>
      </div>
    );
  }

  return children;
}