import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Moon, Sun, ChevronRight, LogOut, User as UserIcon, Bell, Globe, Shield, FileText, Crown, Bike, Users, CheckCircle2, Loader2, ArrowRight
} from 'lucide-react';
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

export default function Settings() {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(false);
  const [signInMethod, setSignInMethod] = useState('password');
  const [selectedPlan, setSelectedPlan] = useState('owner');
  const [processingPlan, setProcessingPlan] = useState(false);
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState(true);

  // Load initial states
  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    const savedMethod = localStorage.getItem('scootlink_signin_method') || 'password';
    setSignInMethod(savedMethod);

    // Load notifications preference
    const savedNotifications = localStorage.getItem('scootlink_notifications');
    setNotifications(savedNotifications !== 'false'); // default true

    auth.me().then(u => {
      setUser(u);
      const currentPlan = u.subscription_plan || u.account_type || 'driver';
      setSelectedPlan(currentPlan === 'both' ? 'both' : currentPlan);
    }).catch(() => {});
  }, []);

  const toggleDarkMode = () => {
    const newDark = !darkMode;
    setDarkMode(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const toggleNotifications = () => {
    const newValue = !notifications;
    setNotifications(newValue);
    localStorage.setItem('scootlink_notifications', newValue);
    toast.success(`Notifications ${newValue ? 'enabled' : 'disabled'}`);
  };

  const toggleSignInMethod = () => {
    const newMethod = signInMethod === 'password' ? 'biometric' : 'password';
    setSignInMethod(newMethod);
    localStorage.setItem('scootlink_signin_method', newMethod);
    if (user) {
      supabase.auth.updateUser({ data: { sign_in_method: newMethod } });
    }
    toast.success(`Sign‑in method changed to ${newMethod === 'biometric' ? 'Biometric' : 'Password'}`);
  };

  const handleSubscribe = async () => {
    setProcessingPlan(true);
    try {
      await auth.updateMe({
        subscription_active: true,
        subscription_plan: selectedPlan,
        subscription_start: new Date().toISOString(),
        subscription_expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await supabase.auth.updateUser({
        data: { subscription_plan: selectedPlan }
      });
      toast.success('Subscription updated!');
      const updatedUser = await auth.me();
      setUser(updatedUser);
    } catch (err) {
      toast.error('Failed to update subscription');
    } finally {
      setProcessingPlan(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
        ← Back
      </button>

      <h2 className="text-2xl font-bold text-foreground mb-8">Settings</h2>

      <Tabs defaultValue="general">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        {/* ───────────── General Tab ───────────── */}
        <TabsContent value="general">
          <div className="space-y-1">
            {/* Account Profile */}
            <button
              onClick={() => navigate('/profile')}
              className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <UserIcon className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Account Profile</p>
                  <p className="text-xs text-muted-foreground">Edit your personal details</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Notifications Toggle */}
            <div
              className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent transition-colors"
              onClick={toggleNotifications}
            >
              <div className="flex items-center gap-3">
                <Bell className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {notifications ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
              </div>
              <div
                className={`h-6 w-10 rounded-full relative transition-colors duration-200 ${
                  notifications ? 'bg-primary' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 ${
                    notifications ? 'right-1' : 'left-1'
                  }`}
                />
              </div>
            </div>

            {/* Dark Mode Toggle */}
            <div
              className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent transition-colors"
              onClick={toggleDarkMode}
            >
              <div className="flex items-center gap-3">
                {darkMode ? <Moon className="w-5 h-5 text-muted-foreground" /> : <Sun className="w-5 h-5 text-muted-foreground" />}
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Dark Mode</p>
                  <p className="text-xs text-muted-foreground">{darkMode ? 'Switch to light mode' : 'Switch to dark mode'}</p>
                </div>
              </div>
              <div className={`h-6 w-10 rounded-full relative transition-colors duration-200 ${darkMode ? 'bg-primary' : 'bg-gray-300'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 ${darkMode ? 'right-1' : 'left-1'}`} />
              </div>
            </div>

            {/* Language (static) */}
            <div className="flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Language</p>
                  <p className="text-xs text-muted-foreground">English</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            {/* Privacy Policy */}
            <div
              className="flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors cursor-pointer"
              onClick={() => alert('Privacy Policy:\nWe collect personal information to provide our services. We never share your data without consent.')}
            >
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Privacy Policy</p>
                  <p className="text-xs text-muted-foreground">How we handle your data</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            {/* Terms of Service */}
            <div
              className="flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors cursor-pointer"
              onClick={() => alert('Terms of Service:\nBy using Scootlink, you agree to our rental terms and payment policies.')}
            >
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Terms of Service</p>
                  <p className="text-xs text-muted-foreground">Our usage terms</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            {/* Logout */}
            <button
              onClick={() => auth.logout()}
              className="w-full mt-4 flex items-center justify-center gap-2 p-4 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors font-medium"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </TabsContent>

        {/* ───────────── Plan Tab ───────────── */}
        <TabsContent value="plan">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose a subscription plan to unlock features.
            </p>

            <div className="grid grid-cols-1 gap-4">
              {PLANS.map(p => {
                const Icon = p.icon;
                const isSelected = selectedPlan === p.id;
                return (
                  <Card
                    key={p.id}
                    onClick={() => setSelectedPlan(p.id)}
                    className={`p-4 cursor-pointer border-2 transition-all ${isSelected ? 'border-primary shadow-lg shadow-primary/10' : 'border-border hover:border-primary/40'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${p.color} border`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="font-bold text-foreground">{p.name}</h3>
                          <p className="text-xs text-muted-foreground">R {p.price}/month</p>
                        </div>
                      </div>
                      {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                    </div>
                    {isSelected && (
                      <ul className="mt-3 space-y-1">
                        {p.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })}
            </div>

            <Button
              onClick={handleSubscribe}
              disabled={processingPlan || selectedPlan === (user?.subscription_plan || 'driver')}
              className="w-full gap-2"
            >
              {processingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {processingPlan ? 'Processing...' : 'Subscribe Now'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Your current plan: {user?.subscription_plan || 'None'}
            </p>
          </div>
        </TabsContent>

        {/* ───────────── Security Tab ───────────── */}
        <TabsContent value="security">
          <div className="space-y-4">
            {/* Sign‑in method toggle */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-card border border-border/50">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Sign‑in method</p>
                  <p className="text-xs text-muted-foreground">
                    Currently: {signInMethod === 'biometric' ? 'Biometric' : 'Password'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={toggleSignInMethod}>
                Switch to {signInMethod === 'password' ? 'Biometric' : 'Password'}
              </Button>
            </div>

            {/* Other security options placeholder */}
            <div className="p-4 rounded-xl bg-card border border-border/50">
              <h3 className="text-sm font-medium text-foreground mb-2">Two‑factor authentication</h3>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
