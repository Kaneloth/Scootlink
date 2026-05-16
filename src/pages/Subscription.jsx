import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Crown, Bike, Users, Shield, Loader2, ArrowRight, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const PLANS = [
  {
    id: 'driver',
    name: 'Driver',
    price: 49,
    period: 'month',
    icon: Bike,
    color: 'bg-blue-50 border-blue-200',
    badgeColor: 'bg-blue-100 text-blue-700',
    features: [
      'Search & rent vehicles',
      'GPS Tracking access',
      'Wallet & payments',
      'Up to 2 active rentals',
      'Driver profile & reviews',
    ],
  },
  {
    id: 'owner',
    name: 'Owner',
    price: 59,
    period: 'month',
    icon: Crown,
    color: 'bg-amber-50 border-amber-200',
    badgeColor: 'bg-amber-100 text-amber-700',
    popular: true,
    features: [
      'List unlimited vehicles',
      'Find & hire drivers',
      'Real-time GPS tracking',
      'Wallet & payouts',
      'Priority listing visibility',
      'Owner analytics dashboard',
    ],
  },
  {
    id: 'both',
    name: 'Fleet Pro',
    price: 79,
    period: 'month',
    icon: Users,
    color: 'bg-primary/5 border-primary/30',
    badgeColor: 'bg-primary/10 text-primary',
    features: [
      'Everything in Owner +',
      'Unlimited active rentals',
      'Drive other vehicles too',
      'Multi-vehicle fleet management',
      'Priority support',
      'Advanced analytics',
    ],
  },
];

export default function Subscription() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [selected, setSelected] = useState('owner');
  const [processing, setProcessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      const plan = u.subscription_plan || u.account_type || 'driver';
      setSelected(plan === 'both' ? 'both' : plan);
    }).catch(() => {});
  }, []);

  const handleSubscribe = async () => {
    setProcessing(true);
    try {
      await auth.updateMe({
        subscription_active: true,
        subscription_plan: selected,
        subscription_start: new Date().toISOString(),
        subscription_expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const { error } = await supabase.auth.updateUser({
        data: { subscription_plan: selected }
      });
      if (error) {
        console.error('Failed to sync auth metadata', error);
        toast.warning('Plan updated, but you may need to re-login.');
      }
      toast.success('Subscription activated! Welcome to Skootlink.');
      window.location.href = '/';
    } catch {
      toast.error('Something went wrong. Please try again.');
      setProcessing(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    try {
      await auth.updateMe({
        subscription_active: false,
        subscription_expires: new Date().toISOString(),
      });
      await supabase.auth.updateUser({ data: { subscription_active: false } });
      toast.success('Subscription cancelled. You can resubscribe any time.');
      const updated = await auth.me();
      setUser(updated);
      setShowCancelConfirm(false);
    } catch {
      toast.error('Failed to cancel subscription. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  const plan = PLANS.find(p => p.id === selected);
  const currentPlanName = PLANS.find(p => p.id === user?.subscription_plan)?.name;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow">
              <Bike className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-foreground">Skootlink</span>
          </Link>
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>

        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Crown className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Choose Your Plan</h1>
          <p className="text-sm text-muted-foreground mt-1">Subscribe to unlock full platform access</p>
        </div>

        {/* Current plan badge */}
        {user?.subscription_active && currentPlanName && (
          <div className="mb-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 text-xs font-medium">
              ● Active: {currentPlanName} Plan
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {PLANS.map(p => {
            const Icon = p.icon;
            const isSelected = selected === p.id;
            const isCurrent = user?.subscription_plan === p.id && user?.subscription_active;
            return (
              <Card
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`p-5 cursor-pointer border-2 transition-all duration-200 relative ${isSelected ? 'border-primary shadow-lg shadow-primary/10' : 'border-border hover:border-primary/40'}`}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-white text-[10px] px-3">Most Popular</Badge>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 right-4">
                    <Badge className="bg-green-600 text-white text-[10px] px-2">Current</Badge>
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <div className={`p-2 rounded-xl ${p.color} border`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                </div>
                <h3 className="font-bold text-foreground">{p.name}</h3>
                <div className="mt-1 mb-4">
                  <span className="text-2xl font-extrabold">R {p.price}</span>
                  <span className="text-xs text-muted-foreground">/{p.period}</span>
                </div>
                <ul className="space-y-1.5">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>

        <Card className="p-5 border border-border/50 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Selected Plan</p>
              <p className="font-bold text-lg">{plan?.name} — R {plan?.price}/month</p>
            </div>
            <Button onClick={handleSubscribe} disabled={processing} className="gap-2 px-6">
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {processing ? 'Processing...' : user?.subscription_active ? 'Switch Plan' : 'Subscribe Now'}
            </Button>
          </div>
        </Card>

        {/* Cancel subscription */}
        {user?.subscription_active && !showCancelConfirm && (
          <div className="text-center mb-4">
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="text-sm text-destructive/70 hover:text-destructive underline underline-offset-2 transition-colors"
            >
              Cancel my subscription
            </button>
          </div>
        )}

        {user?.subscription_active && showCancelConfirm && (
          <Card className="p-5 border border-destructive/30 bg-destructive/5 mb-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm text-destructive/80 space-y-1">
                <p className="font-semibold">Cancel your subscription?</p>
                <p className="text-xs">You'll lose access to all paid features at the end of your current billing period. Your profile and data will be kept.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelling}
              >
                Keep My Plan
              </Button>
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                onClick={handleCancelSubscription}
                disabled={cancelling}
              >
                {cancelling
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling…</>
                  : 'Yes, Cancel'}
              </Button>
            </div>
          </Card>
        )}

        <div className="flex items-center gap-2 justify-center text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5" />
          Payments are encrypted and secure. Cancel anytime.
        </div>
      </div>
    </div>
  );
}
