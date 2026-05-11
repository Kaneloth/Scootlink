import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Moon, Sun, ChevronRight, LogOut, User as UserIcon, Bell, Globe, Shield, FileText,
  Crown, Bike, Users, CheckCircle2, Loader2, ArrowRight, Lock
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

  // Password change states
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

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

    const savedNotifications = localStorage.getItem('scootlink_notifications');
    setNotifications(savedNotifications !== 'false');

    auth.me().then(u => {
      setUser(u);
      const currentPlan = u.subscription_plan || u.account_type || 'driver';
      setSelectedPlan(currentPlan === 'both' ? 'both' : currentPlan);
    }).catch(() => {});
  }, []);

  const toggleDarkMode = () => { /* unchanged */ };

  const toggleNotifications = () => { /* unchanged */ };

  const toggleSignInMethod = () => { /* unchanged */ };

  const handleSubscribe = async () => { /* unchanged */ };

  const handlePasswordChange = async () => {
    setPasswordError('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('Please fill in all password fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated successfully');
      setShowPasswordForm(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error(err);
      setPasswordError(err.message || 'Failed to update password. Your session may have expired. Try logging out and using Forgot password.');
    } finally {
      setChangingPassword(false);
    }
  };

  // ... (rest of the component, including General, Plan, Security tabs)

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      {/* ... back button and header unchanged ... */}

      <Tabs defaultValue="general">
        {/* ... tabs ... */}

        {/* SECURITY TAB */}
        <TabsContent value="security">
          <div className="space-y-4">
            {/* Sign‑in method toggle (unchanged) */}

            {/* Change Password */}
            <div className="p-4 rounded-xl bg-card border border-border/50">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowPasswordForm(!showPasswordForm)}
              >
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Change Password</p>
                    <p className="text-xs text-muted-foreground">
                      {showPasswordForm ? 'Hide form' : 'Update your password'}
                    </p>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${showPasswordForm ? 'rotate-90' : ''}`} />
              </div>

              {showPasswordForm && (
                <div className="mt-4 space-y-3 pt-4 border-t border-border">
                  <div>
                    <Label className="text-xs">Current Password</Label>
                    <Input
                      type="password"
                      className="mt-1"
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">New Password</Label>
                    <Input
                      type="password"
                      className="mt-1"
                      placeholder="At least 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Confirm New Password</Label>
                    <Input
                      type="password"
                      className="mt-1"
                      placeholder="Re-enter new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                  {passwordError && (
                    <p className="text-xs text-destructive">{passwordError}</p>
                  )}
                  <Button onClick={handlePasswordChange} disabled={changingPassword} className="w-full">
                    {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Update Password
                  </Button>
                </div>
              )}
            </div>

            {/* Two‑factor authentication (placeholder) */}
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
