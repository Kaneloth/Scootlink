import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Bike, LogIn, ArrowRight, Loader2, Fingerprint, Lock } from 'lucide-react';
import { toast } from 'sonner';

// ── WebAuthn helpers ──────────────────────────────────────────────────────────

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function triggerBiometricLogin(navigate) {
  if (!window.PublicKeyCredential) {
    throw new Error('Your browser does not support biometric login. Please use password instead.');
  }

  const credentialId = localStorage.getItem('scootlink_biometric_credential_id');
  if (!credentialId) {
    throw new Error('No fingerprint registered. Please sign in with your password, then enable Biometric in Settings.');
  }

  // Prompt the device fingerprint reader
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: base64ToBuffer(credentialId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  // Fingerprint passed — restore the Supabase session.
  // Step 1: try the still-live session first (covers the "lock screen" case
  // where the user navigated to /auth without fully signing out).
  const { data: existing } = await supabase.auth.getSession();
  if (existing?.session) {
    // Keep the stored token in sync with the latest one
    localStorage.setItem('scootlink_biometric_refresh_token', existing.session.refresh_token);
    return existing.session;
  }

  // Step 2: fall back to the stored refresh token (covers a true page reload
  // after the in-memory session was cleared, as long as the token hasn't been
  // invalidated by a hard sign-out).
  const refreshToken = localStorage.getItem('scootlink_biometric_refresh_token');
  if (!refreshToken) {
    throw new Error('No session found. Please sign in with your password once to set up biometric access.');
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) {
    // Token was invalidated (e.g. signed out on another device).
    // Clear it so the error message is accurate next time.
    localStorage.removeItem('scootlink_biometric_refresh_token');
    throw new Error('Your session has fully expired. Please sign in with your password once to restore biometric access.');
  }

  // Rotate — always store the newest token
  localStorage.setItem('scootlink_biometric_refresh_token', data.session.refresh_token);
  return data.session;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Auth() {
  const navigate = useNavigate();

  // 'idle' | 'password' | 'biometric-loading' — controls what the login section shows
  const [loginStage, setLoginStage] = useState('idle');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // ── Sign In button handler ────────────────────────────────────────────────

  const handleSignInTap = async () => {
    const method = localStorage.getItem('scootlink_signin_method') || 'password';

    if (method === 'biometric') {
      setLoginStage('biometric-loading');
      setLoading(true);
      try {
        await triggerBiometricLogin(navigate);
        navigate('/');
      } catch (err) {
        // Stay on the biometric screen — never auto-show the password form.
        // The user must explicitly choose to switch to password.
        toast.error(err.message || 'Biometric login failed. Try again or use password.');
        setLoginStage('biometric-error');
      } finally {
        setLoading(false);
      }
    } else {
      setLoginStage('password');
    }
  };

  // ── Password login ────────────────────────────────────────────────────────

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (error) throw error;

      // If biometric is enabled, keep the refresh token up to date
      if (localStorage.getItem('scootlink_signin_method') === 'biometric' && data.session?.refresh_token) {
        localStorage.setItem('scootlink_biometric_refresh_token', data.session.refresh_token);
      }

      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Register ──────────────────────────────────────────────────────────────

  const handleRegister = async () => {
    if (!regName || !regEmail || !regPassword) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!agreedToTerms) {
      toast.error('You must agree to the Terms and Conditions');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
        options: {
          data: {
            full_name: regName,
            account_type: 'driver',
          },
        },
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Bike className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Scootlink</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The formal way to connect owners and drivers in the delivery space.
          </p>
        </div>

        <Card className="p-6 border border-border/50">
          {isLogin ? (
            /* ─── Login section ─── */
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">
                {loginStage === 'idle' ? 'Welcome back' : 'Sign in'}
              </h2>

              {/* ── Idle state: single Sign In button ── */}
              {loginStage === 'idle' && (
                <Button
                  onClick={handleSignInTap}
                  className="w-full gap-2 h-12 text-base"
                  disabled={loading}
                >
                  {savedMethod === 'biometric' ? (
                    <Fingerprint className="w-5 h-5" />
                  ) : (
                    <LogIn className="w-5 h-5" />
                  )}
                  Sign In
                  {savedMethod === 'biometric' && (
                    <span className="ml-1 text-xs opacity-70">(Fingerprint)</span>
                  )}
                </Button>
              )}

              {/* ── Biometric: scanning ── */}
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
                    onClick={() => setLoginStage('password')}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Use password instead
                  </button>
                </div>
              )}

              {/* ── Biometric: error — stay here, never auto-show password ── */}
              {loginStage === 'biometric-error' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
                    <Fingerprint className="w-10 h-10 text-destructive" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Fingerprint not recognised. Try again.
                  </p>
                  <Button
                    onClick={handleSignInTap}
                    className="w-full gap-2"
                    disabled={loading}
                  >
                    <Fingerprint className="w-4 h-4" />
                    Try Again
                  </Button>
                  <button
                    type="button"
                    onClick={() => setLoginStage('password')}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Use password instead
                  </button>
                </div>
              )}

              {/* ── Password form ── */}
              {loginStage === 'password' && (
                <>
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
                  <Button
                    onClick={handleLogin}
                    className="w-full gap-2"
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                    Sign In
                  </Button>
                  <button
                    type="button"
                    onClick={() => setLoginStage('idle')}
                    className="w-full text-sm text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </button>
                </>
              )}

              <p className="text-center text-sm text-muted-foreground pt-1">
                Don't have an account?{' '}
                <button
                  onClick={() => { setIsLogin(false); setLoginStage('idle'); }}
                  className="text-primary hover:underline"
                >
                  Create one
                </button>
              </p>
            </div>
          ) : (
            /* ─── Register form ─── */
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Create Account</h2>
              <div>
                <Label>Full Name</Label>
                <Input
                  placeholder="Your full name"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                />
              </div>
              <div>
                <Label>Password</Label>
                <Input
                  type="password"
                  placeholder="Create a password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                />
              </div>
              <div>
                <Label>Confirm Password</Label>
                <Input
                  type="password"
                  placeholder="Confirm your password"
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                />
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
              <Button
                onClick={handleRegister}
                className="w-full gap-2"
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                Sign Up
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <button
                  onClick={() => setIsLogin(true)}
                  className="text-primary hover:underline"
                >
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
