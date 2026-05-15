import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Bike, LogIn, ArrowRight, Loader2, Fingerprint, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

// ── WebAuthn helpers ──────────────────────────────────────────────────────────

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function biometricError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function setTokenCookie(refresh_token) {
  await fetch('/.netlify/functions/auth-set-token', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token }),
  });
}

async function triggerBiometricLogin() {
  if (!window.PublicKeyCredential) {
    throw biometricError('unsupported', 'Your browser does not support biometric login.');
  }

  const credentialId = localStorage.getItem('scootlink_biometric_credential_id');
  if (!credentialId) {
    throw biometricError('no-credential', 'No fingerprint registered on this device.');
  }

  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: base64ToBuffer(credentialId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
  } catch (err) {
    // NotAllowedError has two causes:
    //   1. User cancelled the prompt
    //   2. No matching passkey exists on this domain (e.g. registered on localhost,
    //      now on skootlink-temp.netlify.app — WebAuthn is domain-bound)
    // In both cases the credential stored in localStorage is unusable here,
    // so we treat it the same way: fall back to password.
    if (err.name === 'NotAllowedError' || err.name === 'InvalidStateError') {
      throw biometricError('no-credential', 'no-passkey-on-domain');
    }
    throw biometricError('fingerprint-failed', 'Fingerprint not recognised. Try again.');
  }

  // ── Fingerprint passed — restore the Supabase session ──────────────────────

  const { data: existing } = await supabase.auth.getSession();
  if (existing?.session) {
    await setTokenCookie(existing.session.refresh_token);
    return existing.session;
  }

  const res = await fetch('/.netlify/functions/auth-refresh', {
    method: 'POST',
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'no-token') throw biometricError('no-session', 'session-gone');
    throw biometricError('session-expired', 'session-expired');
  }

  const { access_token, refresh_token } = await res.json();
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw biometricError('session-expired', 'session-expired');

  return data.session;
}

// ── Component ─────────────────────────────────────────────────────────────────

// bannerReason controls the message shown on the password form:
//   'session-expired' — biometric session timed out, sign in once to refresh
//   'no-passkey'      — fingerprint not registered on this domain, must re-register
//   null              — no banner

export default function Auth() {
  const navigate = useNavigate();

  const [loginStage, setLoginStage] = useState('idle');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [bannerReason, setBannerReason] = useState(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // ── Sign In button ────────────────────────────────────────────────────────

  const handleSignInTap = async () => {
    const method = localStorage.getItem('scootlink_signin_method') || 'password';
    if (method !== 'biometric') { setLoginStage('password'); return; }

    setLoginStage('biometric-loading');
    setLoading(true);
    try {
      await triggerBiometricLogin();
      navigate('/');
    } catch (err) {
      if (err.code === 'no-session' || err.code === 'session-expired') {
        setBannerReason('session-expired');
        setLoginStage('password');
      } else if (err.code === 'no-credential') {
        // Either no passkey stored, or passkey registered on a different domain.
        // Clear the stale credential ID and fall back to password.
        if (err.message === 'no-passkey-on-domain') {
          localStorage.removeItem('scootlink_biometric_credential_id');
          localStorage.setItem('scootlink_signin_method', 'password');
          setBannerReason('no-passkey');
        } else {
          setBannerReason('session-expired');
        }
        setLoginStage('password');
      } else {
        toast.error(err.message || 'Biometric login failed.');
        setLoginStage('biometric-error');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Password login ────────────────────────────────────────────────────────

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (error) throw error;
      if (data.session?.refresh_token) await setTokenCookie(data.session.refresh_token);
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Register ──────────────────────────────────────────────────────────────

  const handleRegister = async () => {
    if (!regName || !regEmail || !regPassword) { toast.error('Please fill in all required fields'); return; }
    if (regPassword !== regConfirmPassword) { toast.error('Passwords do not match'); return; }
    if (!agreedToTerms) { toast.error('You must agree to the Terms and Conditions'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
        options: { data: { full_name: regName, account_type: 'driver' } },
      });
      if (error) throw error;
      toast.success('Account created! Please check your email to confirm your address.');
      setIsLogin(true);
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password ───────────────────────────────────────────────────────

  const handleForgotPassword = async () => {
    const email = prompt('Enter your email address to reset your password:');
    if (!email) return;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/auth',
      });
      if (error) throw error;
      toast.success('Password reset email sent! Check your inbox.');
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const savedMethod = localStorage.getItem('scootlink_signin_method') || 'password';

  const bannerContent = {
    'session-expired': 'Your biometric session expired. Sign in with your password once — biometric will work automatically from then on.',
    'no-passkey': 'Your fingerprint isn\'t registered on this browser or device. Sign in with your password, then go to Settings → Security → Switch to Biometric to re-register.',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Bike className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Skootlink</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The formal way to connect owners and drivers in the delivery space.
          </p>
        </div>

        <Card className="p-6 border border-border/50">
          {isLogin ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">
                {loginStage === 'idle' ? 'Welcome back' : 'Sign in'}
              </h2>

              {/* Idle: single Sign In button */}
              {loginStage === 'idle' && (
                <Button
                  onClick={handleSignInTap}
                  className="w-full gap-2 h-12 text-base"
                  disabled={loading}
                >
                  {savedMethod === 'biometric'
                    ? <Fingerprint className="w-5 h-5" />
                    : <LogIn className="w-5 h-5" />}
                  Sign In
                  {savedMethod === 'biometric' && (
                    <span className="ml-1 text-xs opacity-70">(Fingerprint)</span>
                  )}
                </Button>
              )}

              {/* Biometric: scanning */}
              {loginStage === 'biometric-loading' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Waiting for fingerprint…
                  </p>
                  <button
                    type="button"
                    onClick={() => { setBannerReason(null); setLoginStage('password'); }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Use password instead
                  </button>
                </div>
              )}

              {/* Biometric: hardware error (wrong finger, cancelled on correct domain) */}
              {loginStage === 'biometric-error' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
                    <Fingerprint className="w-10 h-10 text-destructive" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Fingerprint not recognised. Try again.
                  </p>
                  <Button onClick={handleSignInTap} className="w-full gap-2" disabled={loading}>
                    <Fingerprint className="w-4 h-4" /> Try Again
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setBannerReason(null); setLoginStage('password'); }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Use password instead
                  </button>
                </div>
              )}

              {/* Password form */}
              {loginStage === 'password' && (
                <>
                  {bannerReason && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {bannerContent[bannerReason]}
                      </p>
                    </div>
                  )}
                  <div>
                    <Label>Email</Label>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input
                      type="password"
                      placeholder="Enter your password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  <div className="text-left">
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-sm text-primary hover:underline"
                    >
                      Forgot your password?
                    </button>
                  </div>
                  <Button onClick={handleLogin} className="w-full gap-2" disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                    Sign In
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setBannerReason(null); setLoginStage('idle'); }}
                    className="w-full text-sm text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </button>
                </>
              )}

              <p className="text-center text-sm text-muted-foreground pt-1">
                Don't have an account?{' '}
                <button
                  onClick={() => { setIsLogin(false); setLoginStage('idle'); setBannerReason(null); }}
                  className="text-primary hover:underline"
                >
                  Create one
                </button>
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Create Account</h2>
              <div>
                <Label>Full Name</Label>
                <Input placeholder="Your full name" value={regName} onChange={(e) => setRegName(e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" placeholder="your@email.com" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" placeholder="Create a password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} />
              </div>
              <div>
                <Label>Confirm Password</Label>
                <Input type="password" placeholder="Confirm your password" value={regConfirmPassword} onChange={(e) => setRegConfirmPassword(e.target.value)} />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="terms"
                  checked={agreedToTerms}
                  onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor="terms" className="text-sm text-muted-foreground">
                  I agree to the{' '}
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); alert('Terms and Conditions will be available soon.'); }}
                    className="text-primary hover:underline"
                  >
                    Terms and Conditions
                  </a>
                </label>
              </div>
              <Button onClick={handleRegister} className="w-full gap-2" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Sign Up
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <button onClick={() => setIsLogin(true)} className="text-primary hover:underline">
                  Sign in
                </button>
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
