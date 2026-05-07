import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Bike, Eye, EyeOff, Loader2, Fingerprint } from 'lucide-react';
import { toast } from 'sonner';

export default function Auth() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [biometricUser, setBiometricUser] = useState(null); // { email, credentialId }
  const [checkingBiometric, setCheckingBiometric] = useState(false);

  // After user types their email and blurs, check if they have biometric enrolled
  const checkBiometricForEmail = async (emailVal) => {
    if (!emailVal || !window.PublicKeyCredential) return;
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
    if (!available) return;
    
    try {
      // Use RPC to safely fetch user metadata (requires backend function or RLS bypass)
      const { data } = await supabase.functions.invoke('checkBiometricEnrollment', { email: emailVal });
      if (data?.biometric_enrolled && (data?.sign_in_method === 'biometric' || data?.sign_in_method === 'both')) {
        setBiometricUser({ email: emailVal, credentialId: data.biometric_credential_id });
      } else {
        setBiometricUser(null);
      }
    } catch {
      setBiometricUser(null);
    }
  };

  const handleBiometricSignIn = async () => {
    if (!email) { toast.error('Enter your email first'); return; }
    setLoading(true);
    try {
      // Check if this email has biometric enrolled
      const { data: enrollment } = await supabase.functions.invoke('checkBiometricEnrollment', { email });
      if (!enrollment?.biometric_enrolled) { 
        toast.error('Biometric not enrolled for this email'); 
        setLoading(false);
        return; 
      }

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const allowCredentials = enrollment.biometric_credential_id ? [{
        id: Uint8Array.from(atob(enrollment.biometric_credential_id), c => c.charCodeAt(0)),
        type: 'public-key',
      }] : [];

      await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials,
          userVerification: 'preferred',
          timeout: 60000,
        }
      });

      // WebAuthn verified the device — call backend to generate JWT
      const response = await base44.functions.invoke('biometricSignIn', { email });
      const { access_token, refresh_token } = response.data;

      // Set the session directly in Supabase
      await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      toast.success('Signed in successfully!');
      navigate('/');
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        toast.error('Biometric cancelled. Use password instead.');
      } else {
        toast.error('Biometric sign-in failed: ' + (err.message || 'Unknown error'));
      }
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email) { toast.error('Enter your email address first'); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password reset link sent! Check your email.');
      setShowForgot(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/');
    });
  }, [navigate]);

  const handleResendConfirmation = async (e) => {
    e.preventDefault();
    if (!resendEmail) { toast.error('Enter your email address'); return; }
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: resendEmail });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Confirmation email resent! Check your inbox and spam folder.');
      setShowResend(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      // Redirect to subscription page if not yet subscribed
      const meta = data.user?.user_metadata || {};
      if (!meta.subscription_active) {
        navigate('/subscription');
      } else {
        navigate('/');
      }
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!fullName.trim()) { toast.error('Please enter your full name'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, email } } });
    if (error) { toast.error(error.message); setLoading(false); return; }
    setLoading(false);
    toast.success('Account created! Check your email to confirm, then sign in.');
    setTab('login');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-3 shadow-lg">
            <Bike className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Scootlink</h1>
          <p className="text-sm text-muted-foreground mt-1">Vehicle rental platform</p>
        </div>

        <Card className="p-6 border border-border/50 shadow-sm">
          <div className="flex rounded-lg bg-muted p-1 mb-6">
            <button
              className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-all ${tab === 'login' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setTab('login')}
            >
              Sign In
            </button>
            <button
              className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-all ${tab === 'register' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setTab('register')}
            >
              Register
            </button>
          </div>

          {tab === 'login' ? (
            showResend ? (
              <form onSubmit={handleResendConfirmation} className="space-y-4">
                <p className="text-sm text-muted-foreground">Enter the email you registered with and we'll resend the confirmation link.</p>
                <div>
                  <Label htmlFor="resend-email">Email</Label>
                  <Input id="resend-email" type="email" placeholder="you@example.com" value={resendEmail} onChange={e => setResendEmail(e.target.value)} required className="mt-1" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Resend Confirmation Email'}
                </Button>
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground w-full text-center" onClick={() => setShowResend(false)}>
                  Back to Sign In
                </button>
              </form>
            ) : showForgot ? (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <p className="text-sm text-muted-foreground">Enter your email and we'll send you a reset link.</p>
                <div>
                  <Label htmlFor="reset-email">Email</Label>
                  <Input id="reset-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Reset Link'}
                </Button>
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground w-full text-center" onClick={() => setShowForgot(false)}>
                  Back to Sign In
                </button>
              </form>
            ) : (
            <form onSubmit={handleLogin} className="space-y-4">

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>

              <Button type="button" onClick={handleBiometricSignIn} disabled={loading} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Fingerprint className="w-4 h-4" /> Sign in with Biometric</>}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-card text-muted-foreground">Or use password</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowForgot(true)}>
                    Forgot password?
                  </button>
                </div>
                <div className="relative mt-1">
                  <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="pr-10" />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword(v => !v)}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading} variant="outline">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In with Password'}
              </Button>
              <p className="text-center text-xs text-muted-foreground pt-1">
                Didn't receive a confirmation email?{' '}
                <button type="button" className="text-primary hover:underline" onClick={() => { setResendEmail(email); setShowResend(true); }}>
                  Resend it
                </button>
              </p>
            </form>
            )
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input id="fullName" type="text" placeholder="John Doe" value={fullName} onChange={e => setFullName(e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="reg-email">Email</Label>
                <Input id="reg-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="reg-password">Password</Label>
                <div className="relative mt-1">
                  <Input id="reg-password" type={showPassword ? 'text' : 'password'} placeholder="Min. 6 characters" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className="pr-10" />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPassword(v => !v)}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Account'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}