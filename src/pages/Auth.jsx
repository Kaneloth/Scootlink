import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { saveBiometricRefreshToken, loadBiometricRefreshToken, clearBiometricRefreshToken } from '@/api/supabaseData';
import { sendSMS } from '@/lib/sms';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Bike, LogIn, ArrowRight, Loader2, Fingerprint, AlertTriangle, KeyRound, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { setUser } from '@/lib/sentry';

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
    if (err.name === 'NotAllowedError' || err.name === 'InvalidStateError') {
      throw biometricError('no-credential', 'no-passkey-on-domain');
    }
    throw biometricError('fingerprint-failed', 'Fingerprint not recognised. Try again.');
  }

  // Path 1: Supabase JS has a live session in memory/localStorage
  try {
    const { data: r1 } = await supabase.auth.refreshSession();
    if (r1?.session) {
      saveBiometricRefreshToken(r1.session);
      setTokenCookie(r1.session.refresh_token).catch(() => {});
      return r1.session;
    }
  } catch { /* fall through to Path 2 */ }

  // Path 2: Exchange the stored refresh_token via Supabase REST API
  const backup  = loadBiometricRefreshToken();
  const storedRt = backup?.refresh_token ?? null;
  if (storedRt) {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey    = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const tokenRes = await fetch(
        `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: anonKey },
          body: JSON.stringify({ refresh_token: storedRt }),
        }
      );
      if (tokenRes.ok) {
        const tokens = await tokenRes.json();
        if (tokens.access_token && tokens.refresh_token) {
          const { data: s2, error: e2 } = await supabase.auth.setSession({
            access_token:  tokens.access_token,
            refresh_token: tokens.refresh_token,
          });
          if (!e2 && s2?.session) {
            saveBiometricRefreshToken(s2.session);
            setTokenCookie(s2.session.refresh_token).catch(() => {});
            return s2.session;
          }
        }
      } else {
        const errTxt = await tokenRes.text().catch(() => '');
        if (errTxt.includes('refresh_token_not_found')) clearBiometricRefreshToken();
      }
    } catch { /* fall through to Path 3 */ }
  }

  // Path 3: httpOnly cookie via Netlify function
  try {
    const res = await fetch('/.netlify/functions/auth-refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      const { access_token, refresh_token } = await res.json();
      const { data: s3, error: e3 } = await supabase.auth.setSession({ access_token, refresh_token });
      if (!e3 && s3?.session) {
        saveBiometricRefreshToken(s3.session);
        return s3.session;
      }
    }
  } catch { /* all paths exhausted */ }

  throw biometricError('session-expired', 'session-expired');
}

// ── Fetch phone number via service-role Netlify function ─────────────────────
async function fetchUserPhone(userId) {
  if (!userId) return null;
  try {
    const res = await fetch('/.netlify/functions/get-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [userId] }),
    });
    if (!res.ok) return null;
    const profiles = await res.json();
    return profiles?.[0]?.phone ?? null;
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Auth() {
  const navigate = useNavigate();

  const [loginStage, setLoginStage] = useState('idle');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [bannerReason, setBannerReason] = useState(null);

  // Post-signup confirmation screen
  const [signupDone, setSignupDone] = useState(false);
  const [signupEmail, setSignupEmail] = useState('');

  // "Email not confirmed" login state
  const [unconfirmedEmail, setUnconfirmedEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Forgot-password inline stage
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Password recovery state
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // ── Detect PASSWORD_RECOVERY from reset link ─────────────────────────────
  // Three-pronged approach to catch the recovery token regardless of timing:
  //   1. Check URL hash (implicit flow: #type=recovery)
  //   2. Check sessionStorage flag (survives React Router navigation)
  //   3. onAuthStateChange event (PKCE flow: code exchanged async)
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);

    const isRecoveryUrl =
      hash.includes('type=recovery') ||
      params.get('type') === 'recovery';

    const isRecoveryStored = sessionStorage.getItem('skootlink_recovery') === '1';

    if (isRecoveryUrl || isRecoveryStored) {
      sessionStorage.setItem('skootlink_recovery', '1');
      setRecoveryMode(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('skootlink_recovery', '1');
        setRecoveryMode(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Set new password handler ──────────────────────────────────────────────
  const handleSetNewPassword = async () => {
    if (!newPassword || !confirmNewPassword) {
      toast.error('Please fill in both fields');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      // Get user ID BEFORE updating the password — the recovery session token
      // is consumed by updateUser(), so getUser() returns null if called after.
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const userId = currentUser?.id ?? null;

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      // Send SMS notification to the user's registered phone
      if (!userId) {
        console.warn('[Auth] SMS skipped — could not get user ID before updateUser');
        toast.error('Password updated, but SMS skipped: could not identify user.');
      } else {
        const phone = await fetchUserPhone(userId);
        if (!phone) {
          console.warn('[Auth] SMS skipped — no phone number found for user:', userId);
          toast.error('Password updated, but no phone number found on your profile.');
        } else {
          const smsResult = await sendSMS(phone, 'Your Skootlink password was just changed. If this was not you, please contact support immediately.');
          if (!smsResult.success) {
            console.warn('[Auth] SMS failed:', smsResult.error);
          }
        }
      }

      sessionStorage.removeItem('skootlink_recovery');
      toast.success('Password updated! Please sign in with your new password.');
      setRecoveryMode(false);
      setNewPassword('');
      setConfirmNewPassword('');
      setLoginStage('password');
      setIsLogin(true);
    } catch (err) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password — inline form ─────────────────────────────────────────
  const handleShowForgotPassword = () => {
    // Pre-fill with whatever the user already typed in the login email field
    setResetEmail(loginEmail);
    setResetSent(false);
    setLoginStage('forgot-password');
  };

  const handleSendResetEmail = async () => {
    if (!resetEmail) { toast.error('Please enter your email address'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + '/auth',
      });
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  // ── Sign In button ────────────────────────────────────────────────────────
  const handleSignInTap = async () => {
    const method = localStorage.getItem('scootlink_signin_method') || 'password';
    if (method !== 'biometric') { setLoginStage('password'); return; }

    setLoginStage('biometric-loading');
    setLoading(true);
    try {
      const session = await triggerBiometricLogin();
      setUser({ id: session.user.id, email: session.user.email });
      navigate('/');
    } catch (err) {
      if (err.code === 'no-session' || err.code === 'session-expired') {
        if (err.detail) toast.error(`Debug: ${err.detail}`, { duration: 15000 });
        setBannerReason('session-expired');
        setLoginStage('password');
      } else if (err.code === 'no-credential') {
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

  // ── Resend confirmation email ─────────────────────────────────────────────
  const handleResendConfirmation = async (emailToResend) => {
    setResendLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: emailToResend });
      if (error) throw error;
      toast.success('Confirmation email resent — check your inbox.');
    } catch (err) {
      toast.error(err.message || 'Could not resend confirmation email.');
    } finally {
      setResendLoading(false);
    }
  };

  // ── Password login ────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) { toast.error('Please fill in all fields'); return; }
    setUnconfirmedEmail('');
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (error) {
        // Supabase returns this message when email confirmation is still pending
        if (error.message?.toLowerCase().includes('email not confirmed')) {
          setUnconfirmedEmail(loginEmail);
          return;
        }
        throw error;
      }
      saveBiometricRefreshToken(data.session);
      if (data.session?.refresh_token) await setTokenCookie(data.session.refresh_token);
      setUser({ id: data.user.id, email: data.user.email });
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
      // Show the dedicated confirmation screen instead of a disappearing toast
      setSignupEmail(regEmail);
      setSignupDone(true);
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
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

          {/* ── Post-signup: Check your inbox ──────────────────────────────── */}
          {signupDone ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Check your inbox</h2>
              <p className="text-sm text-muted-foreground">
                We sent a confirmation link to{' '}
                <span className="font-medium text-foreground">{signupEmail}</span>.
                Click it to activate your account before signing in.
              </p>
              <p className="text-xs text-muted-foreground">
                Can't find it? Check your spam folder.
              </p>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => handleResendConfirmation(signupEmail)}
                disabled={resendLoading}
              >
                {resendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Resend confirmation email
              </Button>
              <p className="text-xs text-muted-foreground">
                Once you've clicked the link in the email,{' '}
                <button
                  type="button"
                  onClick={() => { setSignupDone(false); setIsLogin(true); setLoginStage('password'); setLoginEmail(signupEmail); }}
                  className="text-primary hover:underline"
                >
                  sign in here
                </button>
                .
              </p>
            </div>

          ) : /* ── Password Recovery Form (from reset link) ───────────────────── */
          recoveryMode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Set New Password</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Choose a new password for your account.
              </p>
              <div>
                <Label>New Password</Label>
                <Input
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <Label>Confirm New Password</Label>
                <Input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetNewPassword()}
                />
              </div>
              <Button onClick={handleSetNewPassword} className="w-full gap-2" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Update Password
              </Button>
            </div>

          ) : isLogin ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">
                {loginStage === 'idle' ? 'Welcome back' : loginStage === 'forgot-password' ? 'Reset Password' : 'Sign in'}
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

              {/* Biometric: hardware error */}
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

                  {/* Email not confirmed banner */}
                  {unconfirmedEmail && (
                    <div className="flex flex-col gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                      <div className="flex items-start gap-2">
                        <Mail className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-700 dark:text-blue-400">
                          Your email address hasn't been confirmed yet. Check your inbox at{' '}
                          <span className="font-medium">{unconfirmedEmail}</span> and click the confirmation link.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleResendConfirmation(unconfirmedEmail)}
                        disabled={resendLoading}
                        className="text-xs text-blue-700 dark:text-blue-400 underline hover:no-underline self-start disabled:opacity-50"
                      >
                        {resendLoading ? 'Sending…' : 'Resend confirmation email'}
                      </button>
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
                      onClick={handleShowForgotPassword}
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

              {/* Forgot-password inline form */}
              {loginStage === 'forgot-password' && (
                <>
                  {resetSent ? (
                    <div className="flex flex-col items-center gap-4 py-4 text-center">
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <Mail className="w-8 h-8 text-primary" />
                      </div>
                      <p className="text-sm text-foreground font-medium">Reset link sent!</p>
                      <p className="text-sm text-muted-foreground">
                        Check your inbox at <span className="font-medium">{resetEmail}</span> and click the link to set a new password.
                      </p>
                      <button
                        type="button"
                        onClick={() => { setResetSent(false); setLoginStage('password'); }}
                        className="text-sm text-primary hover:underline"
                      >
                        Back to sign in
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Enter your registered email address and we'll send you a link to reset your password.
                      </p>
                      <div>
                        <Label>Email Address</Label>
                        <Input
                          type="email"
                          placeholder="your@email.com"
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendResetEmail()}
                          autoFocus
                        />
                      </div>
                      <Button onClick={handleSendResetEmail} className="w-full gap-2" disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                        Send Reset Link
                      </Button>
                      <button
                        type="button"
                        onClick={() => setLoginStage('password')}
                        className="w-full text-sm text-muted-foreground hover:text-foreground"
                      >
                        ← Back
                      </button>
                    </>
                  )}
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
