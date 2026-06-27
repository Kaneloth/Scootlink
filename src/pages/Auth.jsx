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
import { Bike, LogIn, ArrowRight, Loader2, Fingerprint, AlertTriangle, KeyRound, Mail, Eye, EyeOff, ShieldCheck } from 'lucide-react';
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
  const [googleLoading, setGoogleLoading] = useState(false);
  const [bannerReason, setBannerReason] = useState(null);
  const [isBlacklisted, setIsBlacklisted] = useState(false);

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

  // Email OTP confirmation
  const [signupOtp, setSignupOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);

  // Show/hide password toggles
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showRegPw, setShowRegPw] = useState(false);
  const [showRegConfirmPw, setShowRegConfirmPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmNewPw, setShowConfirmNewPw] = useState(false);

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('skootlink_recovery', '1');
        setRecoveryMode(true);
      }
      // Handle Google OAuth return — Supabase exchanges the code and fires SIGNED_IN
      if (event === 'SIGNED_IN' && session && !sessionStorage.getItem('skootlink_recovery')) {
        window.location.replace('/home');
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
      // Blacklist check layer 1 — profiles.blacklisted flag
      const { data: bioProfile } = await supabase
        .from('profiles')
        .select('blacklisted')
        .eq('id', session.user.id)
        .single();
      if (bioProfile?.blacklisted) {
        await supabase.auth.signOut();
        setIsBlacklisted(true);
        return;
      }
      // Blacklist check layer 2 — ID/passport number in blacklisted_id_numbers
      const { data: bioSensitive } = await supabase
        .from('user_sensitive_info')
        .select('sa_id, passport')
        .eq('user_id', session.user.id)
        .maybeSingle();
      const bioIdNum = (bioSensitive?.sa_id || bioSensitive?.passport || '').trim().toUpperCase();
      if (bioIdNum) {
        const { data: bioBannedRow } = await supabase
          .from('blacklisted_id_numbers')
          .select('id_number')
          .eq('id_number', bioIdNum)
          .maybeSingle();
        if (bioBannedRow) {
          await supabase.auth.signOut();
          setIsBlacklisted(true);
          return;
        }
      }
      setUser({ id: session.user.id, email: session.user.email });
      setLoading(false);
      window.location.replace('/home');
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

  // ── Verify email OTP ──────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (signupOtp.length !== 6) { toast.error('Please enter the full 6-digit code'); return; }
    setOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: signupEmail,
        token: signupOtp,
        type: 'signup',
      });
      if (error) throw error;
      // Verification succeeded — sign out any auto-created session so the user
      // goes through the normal sign-in flow (biometrics, remember-me, etc.)
      await supabase.auth.signOut();
      toast.success('Email confirmed! You can now sign in.');
      setSignupDone(false);
      setSignupOtp('');
      setIsLogin(true);
      setLoginStage('password');
      setLoginEmail(signupEmail);
    } catch (err) {
      toast.error(err.message?.includes('expired') ? 'Code expired — request a new one below.' : (err.message || 'Invalid code. Try again.'));
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Resend confirmation email ─────────────────────────────────────────────
  const handleResendConfirmation = async (emailToResend) => {
    setResendLoading(true);
    setSignupOtp('');
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: emailToResend });
      if (error) throw error;
      toast.success('New code sent — check your inbox.');
    } catch (err) {
      toast.error(err.message || 'Could not resend confirmation code.');
    } finally {
      setResendLoading(false);
    }
  };

  // ── Password login ────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (loading) return;
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
      // Double-check client-side: block sign-in if email hasn't been confirmed yet.
      // This guards against the Supabase dashboard "Email confirmations" setting being toggled off.
      if (data.user && !data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        setUnconfirmedEmail(loginEmail);
        return;
      }
      // Blacklist check layer 1 — profiles.blacklisted flag
      const { data: profile } = await supabase
        .from('profiles')
        .select('blacklisted')
        .eq('id', data.user.id)
        .single();
      if (profile?.blacklisted) {
        await supabase.auth.signOut();
        setIsBlacklisted(true);
        return;
      }
      // Blacklist check layer 2 — ID/passport number in blacklisted_id_numbers.
      // Catches cases where the profile flag wasn't set, or the user created
      // a brand-new account using an already-banned identity document.
      const { data: sensitive } = await supabase
        .from('user_sensitive_info')
        .select('sa_id, passport')
        .eq('user_id', data.user.id)
        .maybeSingle();
      const idNum = (sensitive?.sa_id || sensitive?.passport || '').trim().toUpperCase();
      if (idNum) {
        const { data: bannedIdRow } = await supabase
          .from('blacklisted_id_numbers')
          .select('id_number')
          .eq('id_number', idNum)
          .maybeSingle();
        if (bannedIdRow) {
          await supabase.auth.signOut();
          setIsBlacklisted(true);
          return;
        }
      }
      saveBiometricRefreshToken(data.session);
      if (data.session?.refresh_token) await setTokenCookie(data.session.refresh_token);
      setUser({ id: data.user.id, email: data.user.email });
      setLoading(false);
      window.location.replace('/home');
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
      const { data: signupData, error } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
        options: { data: { full_name: regName, account_type: 'driver' } },
      });
      if (error) throw error;
      // Supabase may return an active session before the email is confirmed.
      // Sign it out immediately so the user cannot enter the app without clicking the link.
      if (signupData?.session) {
        await supabase.auth.signOut();
      }
      // Show the dedicated confirmation screen instead of a disappearing toast
      setSignupEmail(regEmail);
      setSignupDone(true);
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Google Sign-In ────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/auth',
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
            access_type: 'offline',
          },
        },
      });
      if (error) throw error;
      if (data?.url) {
        // Use replace() so the Base44 vite plugin cannot intercept it
        window.location.replace(data.url);
      }
    } catch (err) {
      toast.error(err.message || 'Google sign-in failed');
      setGoogleLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // Suspended account — sign in was blocked; show full-page message
  if (isBlacklisted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-background to-red-50/30 flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-red-700">Account Suspended</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your Skootlink account has been suspended and you cannot access the platform at this time.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              If you believe this is a mistake, please contact our support team and we will review your account.
            </p>
          </div>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Any remaining funds in your Skootlink wallet will be returned to you.
              Email <span className="font-semibold text-foreground">help@skootlink.co.za</span> from
              your registered email address to request a withdrawal of your balance.
            </p>
            <a
              href="mailto:help@skootlink.co.za"
              className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
            >
              <Mail className="w-4 h-4" />
              Contact Support — help@skootlink.co.za
            </a>
            <p className="text-xs text-muted-foreground">
              Wallet withdrawal requests are processed within 5–7 business days.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsBlacklisted(false)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  const savedMethod = localStorage.getItem('scootlink_signin_method') || 'password';

  const bannerContent = {
    'session-expired': 'Your biometric session expired. Sign in with your password once — biometric will work automatically from then on.',
    'no-passkey': 'Your fingerprint isn\'t registered on this browser or device. Sign in with your password, then go to Settings → Security → Switch to Biometric to re-register.',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <img src="/favicon.png" alt="Skootlink" className="w-16 h-16 mx-auto mb-4" />
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
              <h2 className="text-lg font-semibold text-foreground">Confirm your email</h2>
              <p className="text-sm text-muted-foreground">
                We sent a 6-digit code to{' '}
                <span className="font-medium text-foreground">{signupEmail}</span>.
                Enter it below to activate your account.
              </p>
              <div className="w-full">
                <Input
                  placeholder="000000"
                  value={signupOtp}
                  onChange={(e) => setSignupOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center text-2xl tracking-[0.4em] font-mono h-14"
                  maxLength={6}
                  inputMode="numeric"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
                />
              </div>
              <Button
                onClick={handleVerifyOtp}
                className="w-full gap-2"
                disabled={otpLoading || signupOtp.length !== 6}
              >
                {otpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Confirm Email
              </Button>
              <button
                type="button"
                onClick={() => handleResendConfirmation(signupEmail)}
                disabled={resendLoading}
                className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
              >
                {resendLoading ? 'Sending…' : "Didn't receive it? Resend code"}
              </button>
              <p className="text-xs text-muted-foreground">Can't find it? Check your spam folder.</p>

              <div className="w-full border-t border-border/50 pt-3 mt-1 space-y-2 text-center">
                <p className="text-xs text-muted-foreground">
                  Still not receiving the code? Some work and government email addresses block automated emails.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/contact', { state: { backTo: '/auth' } })}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Contact Support
                </button>
              </div>
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
                <div className="relative">
                  <Input
                    type={showNewPw ? 'text' : 'password'}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoFocus
                    className="pr-10"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowNewPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label>Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirmNewPw ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSetNewPassword()}
                    className="pr-10"
                  />
                  <button type="button" tabIndex={-1} onClick={() => setShowConfirmNewPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showConfirmNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
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

              {/* Idle: Google + Sign In buttons */}
              {loginStage === 'idle' && (
                <>
                  <Button variant="outline" className="w-full gap-2 h-12 text-base" onClick={handleGoogleSignIn} disabled={googleLoading}>
                    {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    )}
                    Continue with Google
                  </Button>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <Button
                    onClick={handleSignInTap}
                    className="w-full gap-2 h-12 text-base"
                    disabled={loading}
                  >
                    {savedMethod === 'biometric'
                      ? <Fingerprint className="w-5 h-5" />
                      : <LogIn className="w-5 h-5" />}
                    Sign In with Email
                    {savedMethod === 'biometric' && (
                      <span className="ml-1 text-xs opacity-70">(Fingerprint)</span>
                    )}
                  </Button>
                </>
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
                    <div className="flex flex-col gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                      <div className="flex items-start gap-2">
                        <Mail className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-700 dark:text-blue-400">
                          Your email hasn't been confirmed yet. We sent a 6-digit code to{' '}
                          <span className="font-medium">{unconfirmedEmail}</span> — enter it to activate your account.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => {
                          setSignupEmail(unconfirmedEmail);
                          setSignupOtp('');
                          setSignupDone(true);
                        }}
                      >
                        <ShieldCheck className="w-3.5 h-3.5" /> Enter my confirmation code
                      </Button>
                      <button
                        type="button"
                        onClick={async () => {
                          await handleResendConfirmation(unconfirmedEmail);
                          setSignupEmail(unconfirmedEmail);
                          setSignupDone(true);
                        }}
                        disabled={resendLoading}
                        className="text-xs text-blue-700 dark:text-blue-400 underline hover:no-underline self-start disabled:opacity-50"
                      >
                        {resendLoading ? 'Sending…' : 'Send a new code instead'}
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
                    <div className="relative">
                      <Input
                        type={showLoginPw ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                        className="pr-10"
                      />
                      <button type="button" tabIndex={-1} onClick={() => setShowLoginPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
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
                <Input placeholder="Your full name" value={regName} onChange={(e) => setRegName(e.target.value)} autoComplete="name" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" placeholder="your@email.com" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} autoComplete="email" />
              </div>
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Input type={showRegPw ? 'text' : 'password'} placeholder="Create a password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} className="pr-10" autoComplete="new-password" />
                  <button type="button" tabIndex={-1} onClick={() => setShowRegPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label>Confirm Password</Label>
                <div className="relative">
                  <Input type={showRegConfirmPw ? 'text' : 'password'} placeholder="Confirm your password" value={regConfirmPassword} onChange={(e) => setRegConfirmPassword(e.target.value)} className="pr-10" autoComplete="new-password" />
                  <button type="button" tabIndex={-1} onClick={() => setShowRegConfirmPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showRegConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
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
              <Button variant="outline" className="w-full gap-2 h-12 text-base" onClick={handleGoogleSignIn} disabled={googleLoading}>
                {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                Sign up with Google
              </Button>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or sign up with email</span>
                <div className="flex-1 h-px bg-border" />
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
