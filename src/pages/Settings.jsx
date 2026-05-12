import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import {
  Moon, Sun, ChevronRight, LogOut, User as UserIcon, Bell, Globe, Shield, FileText,
  Crown, Bike, Users, CheckCircle2, Loader2, ArrowRight, Lock, Fingerprint, Trash2,
  AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

const PLANS = [
  {
    id: 'driver', name: 'Driver', price: 49, icon: Bike,
    features: ['Search & rent vehicles', 'GPS Tracking access', 'Wallet & payments', 'Up to 2 active rentals', 'Driver profile & reviews'],
  },
  {
    id: 'owner', name: 'Owner', price: 59, icon: Crown, popular: true,
    features: ['List unlimited vehicles', 'Find & hire drivers', 'Real-time GPS tracking', 'Wallet & payouts', 'Priority listing visibility', 'Owner analytics dashboard'],
  },
  {
    id: 'both', name: 'Fleet Pro', price: 79, icon: Users,
    features: ['Everything in Owner +', 'Unlimited active rentals', 'Drive other vehicles too', 'Multi-vehicle fleet management', 'Priority support', 'Advanced analytics'],
  },
];

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registerBiometric(user) {
  if (!window.PublicKeyCredential) {
    throw new Error('Your device or browser does not support biometric login.');
  }
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Scootlink', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(user?.id || 'scootlink-user'),
        name: user?.email || 'user@scootlink.co.za',
        displayName: user?.full_name || 'Scootlink User',
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  });
  localStorage.setItem('scootlink_biometric_credential_id', bufferToBase64(credential.rawId));
}

async function verifyBiometric() {
  const storedId = localStorage.getItem('scootlink_biometric_credential_id');
  if (!storedId) throw new Error('No biometric credential found on this device.');
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: base64ToBuffer(storedId) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error('Biometric verification failed.');
}

async function clearTokenCookie() {
  await fetch('/.netlify/functions/auth-clear-token', {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}

async function deleteAccount(accessToken) {
  const res = await fetch('/.netlify/functions/auth-delete-account', {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Deletion failed. Please try again.');
  }
}

export default function Settings() {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(false);
  const [signInMethod, setSignInMethod] = useState('password');
  const [selectedPlan, setSelectedPlan] = useState('driver');
  const [processingPlan, setProcessingPlan] = useState(false);
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState(true);
  const [biometricLoading, setBiometricLoading] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [showDeleteSection, setShowDeleteSection] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteVerified, setDeleteVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    setDarkMode(isDark);
    document.documentElement.classList.toggle('dark', isDark);
    setSignInMethod(localStorage.getItem('scootlink_signin_method') || 'password');
    setNotifications(localStorage.getItem('scootlink_notifications') !== 'false');
    auth.me().then((u) => {
      setUser(u);
      const plan = u?.subscription_plan || u?.account_type || 'driver';
      setSelectedPlan(plan === 'both' ? 'both' : plan);
    }).catch(() => {});
  }, []);

  const toggleDarkMode = () => {
    const newDark = !darkMode;
    setDarkMode(newDark);
    document.documentElement.classList.toggle('dark', newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
  };

  const toggleNotifications = () => {
    const val = !notifications;
    setNotifications(val);
    localStorage.setItem('scootlink_notifications', String(val));
    toast.success(`Notifications ${val ? 'enabled' : 'disabled'}`);
  };

  const toggleSignInMethod = async () => {
    const switchingTo = signInMethod === 'password' ? 'biometric' : 'password';
    if (switchingTo === 'biometric') {
      setBiometricLoading(true);
      try {
        await registerBiometric(user);
        setSignInMethod('biometric');
        localStorage.setItem('scootlink_signin_method', 'biometric');
        supabase.auth.updateUser({ data: { sign_in_method: 'biometric' } });
        toast.success('Fingerprint registered! You can now sign in with your fingerprint.');
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          toast.error('Fingerprint setup was cancelled.');
        } else {
          toast.error(err.message || 'Biometric setup failed.');
        }
      } finally {
        setBiometricLoading(false);
      }
    } else {
      localStorage.removeItem('scootlink_biometric_credential_id');
      setSignInMethod('password');
      localStorage.setItem('scootlink_signin_method', 'password');
      supabase.auth.updateUser({ data: { sign_in_method: 'password' } });
      toast.success('Sign-in method changed to Password.');
    }
  };

  const handleLogout = async () => {
    if (localStorage.getItem('scootlink_signin_method') === 'biometric') {
      navigate('/auth');
    } else {
      await clearTokenCookie();
      await auth.logout();
      navigate('/auth');
    }
  };

  const handleVerifyIdentity = async () => {
    setVerifying(true);
    try {
      if (signInMethod === 'biometric') {
        await verifyBiometric();
        setDeleteVerified(true);
        toast.success('Fingerprint verified. You can now confirm deletion.');
      } else {
        if (!deletePassword) { toast.error('Enter your password to continue.'); return; }
        const { error } = await supabase.auth.signInWithPassword({
          email: user?.email,
          password: deletePassword,
        });
        if (error) throw new Error('Incorrect password.');
        setDeleteVerified(true);
        toast.success('Password confirmed. You can now confirm deletion.');
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        toast.error('Fingerprint scan was cancelled.');
      } else {
        toast.error(err.message || 'Verification failed. Try again.');
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteVerified) { toast.error('Verify your identity first.'); return; }
    if (deleteConfirmText !== 'DELETE') { toast.error('Type DELETE in capitals to confirm.'); return; }
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not signed in.');
      await deleteAccount(session.access_token);
      await clearTokenCookie();
      localStorage.clear();
      toast.success('Your account has been permanently deleted.');
      navigate('/auth');
    } catch (err) {
      toast.error(err.message || 'Could not delete account. Please try again.');
    } finally {
      setDeleting(false);
    }
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
      await supabase.auth.updateUser({ data: { subscription_plan: selectedPlan } });
      toast.success('Subscription updated!');
      setUser(await auth.me());
    } catch {
      toast.error('Failed to update subscription');
    } finally {
      setProcessingPlan(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError('');
    if (!currentPassword || !newPassword || !confirmPassword) { setPasswordError('Fill all fields'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return; }
    if (newPassword.length < 6) { setPasswordError('Min 6 characters'); return; }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated!');
      setShowPasswordForm(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      setPasswordError(err.message || 'Failed. Try logging out and using Forgot password.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">← Back</button>
      <h2 className="text-2xl font-bold text-foreground mb-8">Settings</h2>

      <Tabs defaultValue="general">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        {/* ── General tab ── */}
        <TabsContent value="general">
          <div className="space-y-1">
            <button onClick={() => navigate('/profile')} className="w-full flex items-center justify-between p-4 rounded-xl hover:bg-accent transition-colors">
              <div className="flex items-center gap-3">
                <UserIcon className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Account Profile</p>
                  <p className="text-xs text-muted-foreground">Edit personal details</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent" onClick={toggleNotifications}>
              <div className="flex items-center gap-3">
                <Bell className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Notifications</p>
                  <p className="text-xs text-muted-foreground">{notifications ? 'Enabled' : 'Disabled'}</p>
                </div>
              </div>
              <div className={`h-6 w-10 rounded-full relative transition-colors ${notifications ? 'bg-primary' : 'bg-gray-300'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${notifications ? 'right-1' : 'left-1'}`} />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent" onClick={toggleDarkMode}>
              <div className="flex items-center gap-3">
                {darkMode ? <Moon className="w-5 h-5 text-muted-foreground" /> : <Sun className="w-5 h-5 text-muted-foreground" />}
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Dark Mode</p>
                  <p className="text-xs text-muted-foreground">{darkMode ? 'Switch to light' : 'Switch to dark'}</p>
                </div>
              </div>
              <div className={`h-6 w-10 rounded-full relative transition-colors ${darkMode ? 'bg-primary' : 'bg-gray-300'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${darkMode ? 'right-1' : 'left-1'}`} />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl cursor-pointer">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Language</p>
                  <p className="text-xs text-muted-foreground">English</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl cursor-pointer" onClick={() => alert('Privacy Policy')}>
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-muted-foreground" />
                <div className="text-left"><p className="text-sm font-medium text-foreground">Privacy Policy</p></div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl cursor-pointer" onClick={() => alert('Terms of Service')}>
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <div className="text-left"><p className="text-sm font-medium text-foreground">Terms of Service</p></div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>

            <button
              onClick={handleLogout}
              className="w-full mt-4 flex items-center justify-center gap-2 p-4 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </TabsContent>

        {/* ── Plan tab ── */}
        <TabsContent value="plan">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Choose a plan.</p>
            <div className="grid grid-cols-1 gap-4">
              {PLANS.map((p) => {
                const Icon = p.icon;
                const isSel = selectedPlan === p.id;
                return (
                  <Card
                    key={p.id}
                    onClick={() => setSelectedPlan(p.id)}
                    className={`p-4 cursor-pointer border-2 transition-colors ${isSel ? 'border-primary' : 'border-border'}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl border">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="font-bold">{p.name}</h3>
                          <p className="text-xs text-muted-foreground">R{p.price}/month</p>
                        </div>
                      </div>
                      {p.popular && (
                        <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full">Popular</span>
                      )}
                      {isSel && <CheckCircle2 className="w-5 h-5 text-primary" />}
                    </div>
                    <ul className="space-y-1">
                      {p.features.map((f) => (
                        <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <span className="text-primary">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
            </div>
            <Button onClick={handleSubscribe} disabled={processingPlan} className="w-full gap-2">
              {processingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {processingPlan ? 'Processing...' : 'Subscribe Now'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">Current plan: {user?.subscription_plan || 'None'}</p>
          </div>
        </TabsContent>

        {/* ── Security tab ── */}
        <TabsContent value="security">
          <div className="space-y-4">

            {/* Sign-in method */}
            <div className="p-4 rounded-xl bg-card border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {signInMethod === 'biometric'
                    ? <Fingerprint className="w-5 h-5 text-primary" />
                    : <Lock className="w-5 h-5 text-muted-foreground" />}
                  <div>
                    <p className="text-sm font-medium">Sign-in method</p>
                    <p className="text-xs text-muted-foreground">
                      Currently: {signInMethod === 'biometric' ? 'Fingerprint / Biometric' : 'Password'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleSignInMethod}
                  disabled={biometricLoading}
                  className="gap-1.5"
                >
                  {biometricLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  Switch to {signInMethod === 'password' ? 'Biometric' : 'Password'}
                </Button>
              </div>
              {signInMethod === 'biometric' && (
                <p className="text-xs text-muted-foreground mt-3 pl-8">
                  Your fingerprint is registered on this device. The Sign In button on the login screen will prompt your fingerprint directly.
                </p>
              )}
              {signInMethod === 'password' && (
                <p className="text-xs text-muted-foreground mt-3 pl-8">
                  Switch to Biometric to use your device fingerprint sensor at login. You'll be prompted to scan your finger once to register.
                </p>
              )}
            </div>

            {/* Change password */}
            <div className="p-4 rounded-xl bg-card border">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowPasswordForm(!showPasswordForm)}
              >
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Change Password</p>
                    <p className="text-xs text-muted-foreground">{showPasswordForm ? 'Hide form' : 'Update your password'}</p>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 transition-transform ${showPasswordForm ? 'rotate-90' : ''}`} />
              </div>
              {showPasswordForm && (
                <div className="mt-4 space-y-3 pt-4 border-t">
                  <div>
                    <Label className="text-xs">Current Password</Label>
                    <Input type="password" placeholder="..." value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">New Password</Label>
                    <Input type="password" placeholder="6+ chars" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Confirm New</Label>
                    <Input type="password" placeholder="..." value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  </div>
                  {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
                  <Button onClick={handlePasswordChange} disabled={changingPassword} className="w-full">
                    {changingPassword ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Update Password
                  </Button>
                </div>
              )}
            </div>

            {/* Two-factor placeholder */}
            <div className="p-4 rounded-xl bg-card border">
              <h3 className="text-sm font-medium">Two-factor authentication</h3>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>

            {/* Delete account */}
            <div className="p-4 rounded-xl bg-card border border-destructive/30">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => {
                  setShowDeleteSection(!showDeleteSection);
                  setDeleteConfirmText('');
                  setDeletePassword('');
                  setDeleteVerified(false);
                }}
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="w-5 h-5 text-destructive" />
                  <div>
                    <p className="text-sm font-medium text-destructive">Delete Account</p>
                    <p className="text-xs text-muted-foreground">Permanently remove all your data</p>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 text-destructive/60 transition-transform ${showDeleteSection ? 'rotate-90' : ''}`} />
              </div>

              {showDeleteSection && (
                <div className="mt-4 pt-4 border-t border-destructive/20 space-y-4">

                  {/* Warning */}
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <div className="text-xs text-destructive/80 space-y-1">
                      <p className="font-semibold">This cannot be undone.</p>
                      <p>Deleting your account will permanently erase:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>Your profile and all personal information</li>
                        <li>Your ID / passport number</li>
                        <li>Your vehicle listings</li>
                        <li>Your rental history and reviews</li>
                        <li>Your wallet balance</li>
                      </ul>
                    </div>
                  </div>

                  {/* Step 1: identity verification */}
                  <div className={`p-3 rounded-lg border space-y-3 ${deleteVerified ? 'border-green-500/40 bg-green-500/5' : 'border-border bg-muted/30'}`}>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className={`w-4 h-4 shrink-0 ${deleteVerified ? 'text-green-600' : 'text-muted-foreground'}`} />
                      <p className="text-xs font-semibold">
                        {deleteVerified ? 'Identity verified' : 'Step 1 — Verify your identity'}
                      </p>
                    </div>

                    {!deleteVerified && (
                      <>
                        {signInMethod === 'biometric' ? (
                          <p className="text-xs text-muted-foreground pl-6">
                            Scan your fingerprint to confirm it's really you before we delete anything.
                          </p>
                        ) : (
                          <div className="pl-6">
                            <Label className="text-xs">Enter your current password</Label>
                            <Input
                              type="password"
                              placeholder="Your password"
                              className="mt-1"
                              value={deletePassword}
                              onChange={(e) => setDeletePassword(e.target.value)}
                            />
                          </div>
                        )}

                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={handleVerifyIdentity}
                          disabled={verifying || (signInMethod === 'password' && !deletePassword)}
                        >
                          {verifying
                            ? <><Loader2 className="w-3 h-3 animate-spin" /> Verifying…</>
                            : signInMethod === 'biometric'
                              ? <><Fingerprint className="w-3.5 h-3.5" /> Scan Fingerprint</>
                              : <><Lock className="w-3.5 h-3.5" /> Confirm Password</>}
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Step 2: type DELETE — gated until step 1 passes */}
                  <div className={`space-y-3 transition-opacity ${deleteVerified ? 'opacity-100' : 'opacity-40 pointer-events-none select-none'}`}>
                    <div>
                      <Label className="text-xs text-destructive">
                        Step 2 — Type <span className="font-bold tracking-widest">DELETE</span> to confirm
                      </Label>
                      <Input
                        className="mt-1 border-destructive/40 focus-visible:ring-destructive/40"
                        placeholder="DELETE"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck="false"
                        disabled={!deleteVerified}
                      />
                    </div>

                    <Button
                      variant="destructive"
                      className="w-full gap-2"
                      onClick={handleDeleteAccount}
                      disabled={deleting || !deleteVerified || deleteConfirmText !== 'DELETE'}
                    >
                      {deleting
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting account…</>
                        : <><Trash2 className="w-4 h-4" /> Permanently Delete My Account</>}
                    </Button>
                  </div>

                  <p className="text-[11px] text-center text-muted-foreground">
                    In accordance with POPIA, all your personal data will be erased within seconds.
                  </p>
                </div>
              )}
            </div>

          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
