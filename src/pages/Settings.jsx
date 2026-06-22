import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, supabase, saveBiometricRefreshToken } from '@/api/supabaseData';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import {
  Moon, Sun, ChevronRight, LogOut, User as UserIcon, Bell, Globe, Shield, FileText,
  Crown, Bike, Users, CheckCircle2, Loader2, ArrowRight, Lock, Fingerprint, Trash2,
  AlertTriangle, ShieldCheck, XCircle, Info, Type, LifeBuoy, Copy, Upload, Coins,
} from 'lucide-react';
import { sendSMS } from '@/lib/sms';

import { toast } from 'sonner';
import { useCredits } from '@/hooks/useCredits';

// Text size options stored as root font-size in px
const TEXT_SIZES = [
  { label: 'Normal',   value: '16px' },
  { label: 'Large',    value: '18px' },
  { label: 'X-Large', value: '20px' },
];

// ── Put your admin email(s) here ────────────────────────────────────────────
const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];

const CREDIT_PACKAGES = [
  { id: 'starter',  label: 'Starter Pack',  price: 29,  credits: 10  },
  { id: 'standard', label: 'Standard Pack', price: 49,  credits: 30, popular: true },
  { id: 'pro',      label: 'Pro Pack',      price: 79,  credits: 60  },
  { id: 'business', label: 'Business Pack', price: 199, credits: 200 },
];

// ── WebAuthn helpers ──────────────────────────────────────────────────────────

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registerBiometric(user) {
  if (!window.PublicKeyCredential) {
    throw new Error('Biometric authentication is not supported on this device or browser.');
  }
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Skootlink', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(user?.id || 'skootlink-user'),
        name: user?.email || 'user@skootlink.co.za',
        displayName: user?.full_name || user?.email || 'Skootlink User',
      },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        // residentKey intentionally omitted — Crosssa pattern.
        // residentKey:'preferred' triggers the OS passkey/iCloud Keychain prompt.
      },
      timeout: 60000,
    },
  });
  localStorage.setItem('scootlink_biometric_credential_id', bufferToBase64(credential.rawId));
}

// Returns true if the fingerprint scan passed.
// Throws with err.code = 'no-passkey-on-domain' when the stored credential
// doesn't exist on this domain (e.g. registered on localhost, used on Netlify).
async function verifyBiometric() {
  const storedId = localStorage.getItem('scootlink_biometric_credential_id');
  if (!storedId) {
    const err = new Error('No biometric credential found on this device.');
    err.code = 'no-credential';
    throw err;
  }
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: base64ToBuffer(storedId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (!assertion) throw new Error('Biometric verification failed.');
  } catch (err) {
    // NotAllowedError = user cancelled OR no matching passkey on this domain.
    // Either way the stored credential is unusable here — signal the caller.
    if (err.name === 'NotAllowedError' || err.name === 'InvalidStateError') {
      const e = new Error('no-passkey-on-domain');
      e.code = 'no-passkey-on-domain';
      throw e;
    }
    throw err;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

async function clearTokenCookie() {
  await fetch('/.netlify/functions/auth-clear-token', {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}

// ── Account deletion ──────────────────────────────────────────────────────────

async function deleteAccount(accessToken) {
  const res = await fetch('/.netlify/functions/auth-delete-account', {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Include server detail (e.g. "Failed to delete account" + raw Supabase reason)
    const reason = body.error || `Request failed (${res.status})`;
    const detail = body.detail ? ` — ${body.detail}` : '';
    throw new Error(reason + detail);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Inline credits widget for Settings tab ────────────────────────────────
function CreditBalanceWidget() {
  const { balance, loading, refetch } = useCredits();
  const [purchasing, setPurchasing] = React.useState(null);

  const handlePurchase = async (pkg) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error('Please sign in first.'); return; }
    setPurchasing(pkg.id);
    try {
      const res = await fetch('/.netlify/functions/payfast-initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ package_id: pkg.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = data.action_url;
      Object.entries(data.fields).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = key; input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      toast.error(err.message || 'Could not start payment.');
      setPurchasing(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Balance */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-primary/5 border border-primary/20">
        <div>
          <p className="text-xs text-muted-foreground">Your credit balance</p>
          {loading
            ? <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mt-1" />
            : <p className="text-3xl font-bold text-primary">{balance}</p>
          }
          <p className="text-xs text-muted-foreground mt-0.5">credits · never expire</p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Coins className="w-6 h-6 text-primary" />
        </div>
      </div>

      {/* What credits cost */}
      <div className="p-3 rounded-xl bg-muted/50 border border-border/50 space-y-1.5">
        <p className="text-xs font-semibold text-foreground">Credit costs:</p>
        {[
          ['Start or reply to a new chat', 3],
          ['List a vehicle', 10],
          ['Access rental agreement', 30],
          ['ID / licence verification', 30],
        ].map(([action, cost]) => (
          <div key={action} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{action}</span>
            <span className="font-semibold">{cost} cr</span>
          </div>
        ))}
      </div>

      {/* Packages */}
      <p className="text-sm font-semibold text-foreground">Buy credits</p>
      <div className="space-y-2">
        {CREDIT_PACKAGES.map(pkg => (
          <button
            key={pkg.id}
            onClick={() => handlePurchase(pkg)}
            disabled={purchasing !== null}
            className={`w-full text-left rounded-2xl border p-4 transition-all hover:border-primary disabled:opacity-60 ${pkg.popular ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{pkg.label}</p>
                  {pkg.popular && <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">POPULAR</span>}
                </div>
                <p className="text-xs text-muted-foreground">{pkg.credits} credits</p>
              </div>
              <div className="text-right">
                <p className="font-bold">R{pkg.price}</p>
                {purchasing === pkg.id
                  ? <Loader2 className="w-4 h-4 animate-spin text-primary ml-auto" />
                  : <p className="text-[10px] text-muted-foreground">R{(pkg.price / pkg.credits).toFixed(2)}/cr</p>
                }
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'general');
  const [darkMode, setDarkMode] = useState(false);
  const [fontSize, setFontSize] = useState('16px');
  const [signInMethod, setSignInMethod] = useState('password');
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState(true);
  const [biometricLoading, setBiometricLoading] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Delete account state
  const [showDeleteSection, setShowDeleteSection] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteVerified, setDeleteVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // true = biometric failed on this domain, show password fallback
  const [biometricFallback, setBiometricFallback] = useState(false);

  // ── Admin panel state ────────────────────────────────────────────────────
  const [adminUsers, setAdminUsers] = useState([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [adminFilter, setAdminFilter] = useState('');
  const [togglingId, setTogglingId] = useState(null);
  const [blacklistingId, setBlacklistingId] = useState(null);
  const [adminSelectedUser, setAdminSelectedUser] = useState(null); // user open in detail/edit modal
  const [adminEditForm, setAdminEditForm] = useState(null);          // edit form state
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState('view');        // 'view' | 'edit'

  // ── Plan tab — licence verification ─────────────────────────────────────
  const [licencePlanStatus, setLicencePlanStatus] = useState('idle');
  const [licencePlanMsg, setLicencePlanMsg]       = useState('');
  const [licenceFrontFile, setLicenceFrontFile] = useState(null);
  const [licenceBackFile,  setLicenceBackFile]  = useState(null);
  const licenceFrontInputRef = useRef(null);
  const licenceBackInputRef  = useRef(null);

  // ── Plan tab — SA ID / Passport ──────────────────────────────────────────
  const [idDocType, setIdDocType] = useState('sa_id');   // 'sa_id' | 'passport'
  const [idDocNumber, setIdDocNumber] = useState('');
  const [idDocError, setIdDocError] = useState('');

  // Passport image upload
  const [frontPassportFile, setFrontPassportFile] = useState(null);
  const [backPassportFile,  setBackPassportFile]  = useState(null);
  const frontInputRef = useRef(null);
  const backInputRef  = useRef(null);

  // ── Plan tab — cancel subscription ──────────────────────────────────────

  // ── Identity verification (VerifyNow) ────────────────────────────────────
  const [verifyIdStatus, setVerifyIdStatus] = useState('idle'); // idle | verifying | verified | failed
  const [verifyIdMsg, setVerifyIdMsg] = useState('');

  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    setDarkMode(isDark);
    document.documentElement.classList.toggle('dark', isDark);
    const savedSize = localStorage.getItem('scootlink_font_size') || '16px';
    setFontSize(savedSize);
    document.documentElement.style.fontSize = savedSize;
    setSignInMethod(localStorage.getItem('scootlink_signin_method') || 'password');
    setNotifications(localStorage.getItem('scootlink_notifications') !== 'false');
    loadUser().then(setUser).catch(() => {});
  }, []);

  const toggleDarkMode = () => {
    const newDark = !darkMode;
    setDarkMode(newDark);
    document.documentElement.classList.toggle('dark', newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
  };

  const changeFontSize = (size) => {
    setFontSize(size);
    document.documentElement.style.fontSize = size;
    localStorage.setItem('scootlink_font_size', size);
  };

  const toggleNotifications = () => {
    const val = !notifications;
    setNotifications(val);
    localStorage.setItem('scootlink_notifications', String(val));
    toast.success(`Notifications ${val ? 'enabled' : 'disabled'}`);
  };

  // ── Sign-in method toggle ────────────────────────────────────────────────

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

  // ── Logout ────────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    if (localStorage.getItem('scootlink_signin_method') === 'biometric') {
      // Screen lock — do NOT call signOut(). The Supabase session stays alive
      // in localStorage so fingerprint can restore it instantly on next login.
      // (Crosssa pattern: unlockApp() reads this kept-alive session directly.)
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) saveBiometricRefreshToken(data.session);
      } catch { /* non-fatal */ }
      navigate('/auth');
    } else {
      await clearTokenCookie();
      await auth.logout();
      navigate('/auth');
    }
  };

  // ── Delete: step 1 — verify identity ─────────────────────────────────────

  const handleVerifyIdentity = async () => {
    setVerifying(true);
    try {
      if (signInMethod === 'biometric' && !biometricFallback) {
        await verifyBiometric();
        setDeleteVerified(true);
        toast.success('Fingerprint verified. You can now confirm deletion.');
      } else {
        // Password path (either always-password user, or biometric fallback)
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
      if (err.code === 'no-passkey-on-domain') {
        // Fingerprint registered on a different domain — silently switch to
        // the password fallback so the user isn't blocked.
        setBiometricFallback(true);
        toast.error('Fingerprint not registered on this browser. Enter your password instead.');
      } else if (err.name === 'NotAllowedError') {
        toast.error('Fingerprint scan was cancelled. Try again or use your password.');
      } else {
        toast.error(err.message || 'Verification failed. Try again.');
      }
    } finally {
      setVerifying(false);
    }
  };

  // ── Delete: step 2 — final deletion ──────────────────────────────────────

  const handleDeleteAccount = async () => {
    if (!deleteVerified) { toast.error('Verify your identity first.'); return; }
    if (deleteConfirmText !== 'DELETE') { toast.error('Type DELETE in capitals to confirm.'); return; }
    setDeleting(true);
    try {
      // Force a fresh access token via the Supabase client's stored refresh
      // token (set during login via supabase.auth.setSession). This is more
      // reliable than the httpOnly-cookie route, which can fail if the cookie
      // has already rotated since the last page load.
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      const access_token = refreshed?.session?.access_token;
      if (refreshErr || !access_token) {
        throw new Error('Session expired — please log out and log in again before deleting your account.');
      }

      await deleteAccount(access_token);
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

  // ── SA ID DOB extraction ──────────────────────────────────────────────────

  // Returns age from a 13-digit SA ID number, or null if invalid format.
  function ageFromSAId(idNum) {
    const clean = idNum.replace(/\s/g, '');
    if (!/^\d{13}$/.test(clean)) return null;
    const yy = parseInt(clean.slice(0, 2), 10);
    const mm = parseInt(clean.slice(2, 4), 10);
    const dd = parseInt(clean.slice(4, 6), 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const currentYY = new Date().getFullYear() % 100;
    const fullYear = yy <= currentYY ? 2000 + yy : 1900 + yy;
    const dob = new Date(fullYear, mm - 1, dd);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const mo = today.getMonth() - dob.getMonth();
    if (mo < 0 || (mo === 0 && today.getDate() < dob.getDate())) age--;
    return age;
  }

  // Validate SA ID doc number on change and auto-flag under-18
  const handleIdDocChange = (val) => {
    setIdDocNumber(val);
    setIdDocError('');
    if (idDocType === 'sa_id') {
      const clean = val.replace(/\s/g, '');
      if (clean.length === 13) {
        const age = ageFromSAId(clean);
        if (age === null) {
          setIdDocError('ID number format is invalid — please double-check.');
        } else if (age < 18) {
          setIdDocError('Your SA ID shows you are under 18. Skootlink is for adults only.');
        }
      }
    }
  };

  // Pre-fill ID from saved profile when user loads
  useEffect(() => {
    if (user?.id_document_number) setIdDocNumber(user.id_document_number);
    if (user?.id_document_type)   setIdDocType(user.id_document_type);
    // If already verified, reflect that in the UI immediately
    if (user?.verified) {
      setVerifyIdStatus('verified');
      setVerifyIdMsg('Identity previously verified ✓');
    }
  }, [user]);

  const needsLicencePlan = true; // all users can verify licence

  // ── Identity document verification via VerifyNow ─────────────────────────

  const handleVerifyId = async () => {
    // Validate inputs per document type
    if (idDocType === 'sa_id') {
      if (!idDocNumber.trim()) { toast.error('Please enter your SA ID number'); return; }
      if (idDocNumber.replace(/\s/g, '').length !== 13) {
        toast.error('SA ID must be exactly 13 digits'); return;
      }
      if (idDocError) { toast.error('Please fix the ID error before verifying'); return; }
    } else {
      if (!frontPassportFile || !backPassportFile) {
        toast.error('Please upload both front and back passport images'); return;
      }
    }

    // Deduct 30 credits before verifying
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser) {
      const { error: creditErr } = await supabase.rpc('deduct_credits', {
        p_user_id: currentUser.id, p_amount: 30, p_type: 'spend',
        p_description: 'ID/passport verification', p_ref_id: 'verify-identity',
      });
      if (creditErr?.message?.includes('insufficient_credits')) {
        toast.error('You need 30 credits to verify your identity. Buy more credits in the Credits tab.');
        return;
      }
    }
    setVerifyIdStatus('verifying');
    setVerifyIdMsg('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      let requestBody = {};
      if (idDocType === 'sa_id') {
        requestBody = {
          idNumber: idDocNumber.trim().toUpperCase(),
          documentType: 'sa_id',
        };
      } else {
        // Convert images to base64 for passport submission
        const toBase64 = file => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result); // data:image/jpeg;base64,...
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const frontBase64 = await toBase64(frontPassportFile);
        const backBase64  = await toBase64(backPassportFile);
        requestBody = {
          documentType:    'passport',
          frontImageBase64: frontBase64,
          backImageBase64:  backBase64,
        };
      }

      const res = await fetch('/.netlify/functions/verify-identity', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (data.verified) {
        setVerifyIdStatus('verified');
        setVerifyIdMsg(data.message || 'Identity verified successfully');
        toast.success('Identity verified! Your ✅ ID Verified badge will appear on your profile.');
        setUser(await loadUser());
      } else {
        setVerifyIdStatus('failed');
        setVerifyIdMsg(data.message || 'Verification failed. Check your details and try again.');
        toast.error(data.message || 'Verification failed. Contact support if this continues.');
      }
    } catch (err) {
      setVerifyIdStatus('failed');
      setVerifyIdMsg('Verification service unavailable. Please try again later.');
      toast.error('Verification error: ' + (err.message || 'Unknown error'));
    }
  };

  // Pre-fill: licence fields removed (image upload replaces number/year inputs)

  // ── Plan tab — verify licence (image upload) ──────────────────────────────

  const handleVerifyLicencePlan = async () => {
    if (!licenceFrontFile || !licenceBackFile) {
      toast.error('Please upload both the front and back of your driving licence');
      return;
    }
    // Deduct 30 credits before verifying
    const { data: { user: licUser } } = await supabase.auth.getUser();
    if (licUser) {
      const { error: licCreditErr } = await supabase.rpc('deduct_credits', {
        p_user_id: licUser.id, p_amount: 30, p_type: 'spend',
        p_description: 'Driving licence verification', p_ref_id: 'verify-licence',
      });
      if (licCreditErr?.message?.includes('insufficient_credits')) {
        toast.error('You need 30 credits to verify your licence. Buy more credits in the Credits tab.');
        return;
      }
    }
    setLicencePlanStatus('verifying');
    setLicencePlanMsg('');
    try {
      // Compress image to JPEG ≤ 1200px wide at 80% quality (~150-300 KB each)
      // Keeps payload well under Netlify's 6 MB function limit
      const compressImage = (file, maxPx = 1200, quality = 0.8) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
            const scale  = Math.min(1, maxPx / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width  = Math.round(img.width  * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.onerror = reject;
          img.src = url;
        });

      const [frontBase64, backBase64] = await Promise.all([
        compressImage(licenceFrontFile),
        compressImage(licenceBackFile),
      ]);

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/verify-licence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          licenceFrontImageBase64: frontBase64,
          licenceBackImageBase64:  backBase64,
        }),
      });
      const result = await res.json();
      // result.error = early-exit errors (auth, missing fields, etc.)
      // result.message = VerifyNow result messages
      const displayMsg = result.message || result.error || 'Could not verify your licence. Please try again.';
      if (result.verified || result.pending) {
        setLicencePlanStatus('verified');
        setLicencePlanMsg(result.message || 'Driving licence verified successfully.');
        toast.success(result.pending
          ? 'Licence submitted — pending admin review. 🛡️'
          : 'Driving licence verified! 🛡️ Fully Verified badge earned.');
        setUser(await loadUser());
      } else {
        setLicencePlanStatus('failed');
        setLicencePlanMsg(displayMsg);
        toast.error(displayMsg);
        // Log full server response to browser console for debugging
        console.error('[verify-licence] Server response:', result);
      }
    } catch (err) {
      setLicencePlanStatus('failed');
      setLicencePlanMsg('Verification service unavailable. Please try again later.');
      toast.error('Licence verification error. Please try again.');
      console.error('[verify-licence] Fetch/parse error:', err);
    }
  };


  // ── User loader (merges customer_code which auth.me() may omit) ──────────

  const loadUser = async () => {
    const u = await auth.me();
    if (u?.id) {
      const { data } = await supabase
        .from('profiles')
        .select('customer_code')
        .eq('id', u.id)
        .single();
      if (data?.customer_code) return { ...u, customer_code: data.customer_code };
    }
    return u;
  };

  // ── Admin helpers ─────────────────────────────────────────────────────────

  const isAdmin = user && (user?.user_metadata?.is_admin === true || ADMIN_EMAILS.includes(user.email));

  const fetchAdminUsers = async () => {
    setLoadingAdminUsers(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, verified, id_verified, licence_verified, license_pending, verification_badge, account_type, customer_code, phone, location, residential_address, license_number, license_year, blacklisted, id_document_number, id_document_type, created_at')
      .order('created_at', { ascending: false });
    if (!error) {
      // Fetch credit balances for each user
      const userIds = (data || []).map(u => u.id);
      let creditMap = {};
      if (userIds.length > 0) {
        const { data: credits } = await supabase
          .from('credit_ledger')
          .select('user_id, amount')
          .in('user_id', userIds);
        (credits || []).forEach(c => {
          creditMap[c.user_id] = (creditMap[c.user_id] || 0) + c.amount;
        });
      }
      setAdminUsers((data || []).map(u => ({ ...u, credit_balance: creditMap[u.id] ?? 0 })));
    } else {
      toast.error('Could not load users: ' + (error.message || 'unknown error'));
    }
    setLoadingAdminUsers(false);
  };

  const toggleVerified = async (userId, currentVerified) => {
    setTogglingId(userId);
    const { error } = await supabase
      .from('profiles')
      .update({ verified: !currentVerified })
      .eq('id', userId);
    if (!error) {
      setAdminUsers(prev =>
        prev.map(u => u.id === userId ? { ...u, verified: !currentVerified } : u)
      );
      toast.success(currentVerified ? 'User unverified' : 'User verified ✓');
    } else {
      toast.error('Failed to update verification');
    }
    setTogglingId(null);
  };

  const toggleLicenceVerified = async (userId, currentLicenceVerified, currentIdVerified) => {
    setTogglingId(userId + '_lic');
    const enabling = !currentLicenceVerified;
    const now = new Date().toISOString();
    const badge = enabling
      ? (currentIdVerified ? 'fully_verified' : 'dl_verified')
      : (currentIdVerified ? 'id_verified' : null);

    // ── Step 1: safe columns (guaranteed to exist in all schema versions) ─────
    const safeUpdate = enabling
      ? { license_verified: true, license_pending: false }
      : { license_verified: false };
    const { error: safeErr } = await supabase.from('profiles').update(safeUpdate).eq('id', userId);
    if (safeErr) {
      toast.error('Failed to update licence: ' + (safeErr.message || 'unknown error'));
      setTogglingId(null);
      return;
    }

    // ── Step 2: new badge columns (added by migration — silently skip if missing) ─
    const badgeUpdate = enabling
      ? { licence_verified: true, licence_verified_at: now, verification_badge: badge }
      : { licence_verified: false, verification_badge: badge };
    await supabase.from('profiles').update(badgeUpdate).eq('id', userId);
    // (error ignored — these columns may not exist yet if migration hasn't been run)

    setAdminUsers(prev =>
      prev.map(u => u.id === userId
        ? { ...u, licence_verified: enabling, license_pending: enabling ? false : u.license_pending, verification_badge: badge }
        : u)
    );
    if (adminSelectedUser?.id === userId) {
      setAdminSelectedUser(p => ({ ...p, licence_verified: enabling, verification_badge: badge }));
    }
    toast.success(enabling ? 'Licence verified ✓' : 'Licence verification removed');
    setTogglingId(null);
  };

  const addAdminCredits = async (userId, amount) => {
    setTogglingId(userId + '_sub');
    const { error } = await supabase.rpc('add_credits', {
      p_user_id:     userId,
      p_amount:      amount,
      p_type:        'adjustment',
      p_description: `Admin credit adjustment`,
      p_ref_id:      `admin:${userId}`,
    });
    if (!error) {
      toast.success(`Added ${amount} credits to user`);
    } else {
      toast.error('Failed to add credits: ' + error.message);
    }
    setTogglingId(null);
  };

  const blacklistUser = async (userId, currentBlacklisted) => {
    setBlacklistingId(userId);
    const banning = !currentBlacklisted;

    // 1. Toggle the blacklisted flag on the profile
    const { error } = await supabase
      .from('profiles')
      .update({ blacklisted: banning })
      .eq('id', userId);

    if (error) {
      toast.error('Failed to update blacklist: ' + (error.message || 'unknown error'));
      setBlacklistingId(null);
      return;
    }

    // 2. Look up the user's SA ID / passport from user_sensitive_info
    //    (the authoritative source — not profiles.id_document_number)
    const { data: sensitiveRow } = await supabase
      .from('user_sensitive_info')
      .select('sa_id, passport')
      .eq('user_id', userId)
      .maybeSingle();

    const idNum = (sensitiveRow?.sa_id || sensitiveRow?.passport || '').trim().toUpperCase();

    if (idNum) {
      if (banning) {
        await supabase
          .from('blacklisted_id_numbers')
          .upsert({ id_number: idNum }, { onConflict: 'id_number' });
      } else {
        await supabase
          .from('blacklisted_id_numbers')
          .delete()
          .eq('id_number', idNum);
      }
    }

    // 3. Ban / unban at the Supabase Auth level and revoke all active sessions.
    //    This blocks any new sign-in attempt and immediately invalidates existing
    //    sessions so the user is kicked out of the app without waiting for the
    //    access token to expire naturally.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (accessToken) {
        await fetch('/.netlify/functions/admin-ban-user', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ userId, ban: banning }),
        });
      }
    } catch {
      // Non-fatal — profiles.blacklisted still blocks app access on next load
    }

    setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, blacklisted: banning } : u));
    if (adminSelectedUser?.id === userId) setAdminSelectedUser(p => ({ ...p, blacklisted: banning }));
    toast.success(currentBlacklisted ? 'User unblacklisted ✓' : 'User blacklisted ⛔');
    setBlacklistingId(null);
  };

  const openAdminUser = (u) => {
    setAdminSelectedUser(u);
    setAdminEditForm({
      full_name:           u.full_name || '',
      phone:               u.phone || '',
      location:            u.location || '',
      residential_address: u.residential_address || '',
      license_number:      u.license_number || '',
      license_year:        u.license_year ? String(u.license_year) : '',
      account_type:        u.account_type || 'driver',
    });
    setAdminModalTab('view');
  };

  const saveAdminEdit = async () => {
    if (!adminSelectedUser || !adminEditForm) return;
    setAdminSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name:           adminEditForm.full_name,
        phone:               adminEditForm.phone,
        location:            adminEditForm.location,
        residential_address: adminEditForm.residential_address,
        license_number:      adminEditForm.license_number || null,
        license_year:        adminEditForm.license_year ? parseInt(adminEditForm.license_year) : null,
        account_type:        adminEditForm.account_type,
      })
      .eq('id', adminSelectedUser.id);
    if (!error) {
      const updated = { ...adminSelectedUser, ...adminEditForm, license_year: adminEditForm.license_year ? parseInt(adminEditForm.license_year) : null };
      setAdminUsers(prev => prev.map(u => u.id === adminSelectedUser.id ? updated : u));
      setAdminSelectedUser(updated);
      toast.success('Profile updated ✓');
      setAdminModalTab('view');
    } else {
      toast.error('Failed to save: ' + error.message);
    }
    setAdminSaving(false);
  };

  // ── Plan ─────────────────────────────────────────────────────────────────


  // ── Password change ───────────────────────────────────────────────────────

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
      try {
        if (user?.phone) {
          await sendSMS(user.phone, `Your Skootlink password was just changed. If this wasn't you, contact support immediately at help@skootlink.co.za.`);
        }
      } catch { /* SMS failure must never block the main flow */ }
    } catch (err) {
      setPasswordError(err.message || 'Failed. Try logging out and using Forgot password.');
    } finally {
      setChangingPassword(false);
    }
  };

  // Whether the delete verify step uses the password input
  const deleteUsesPassword = signInMethod === 'password' || biometricFallback;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">← Back</button>
      <h2 className="text-2xl font-bold text-foreground mb-8">Settings</h2>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'} mb-6`}>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin" onClick={fetchAdminUsers}>Admin</TabsTrigger>}
        </TabsList>

        {/* ── General tab ── */}
        <TabsContent value="general">
          <div className="space-y-1">
            {/* Customer Code card */}
            {user?.customer_code && (
              <div className="mb-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Your Customer Code</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-bold tracking-widest text-foreground font-mono">{user.customer_code}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(user.customer_code);
                      toast.success('Customer code copied!');
                    }}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">Quote this code whenever you contact Skootlink support.</p>
              </div>
            )}

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
                  <p className="text-sm font-medium text-foreground">{darkMode ? 'Dark Mode' : 'Light Mode'}</p>
                  <p className="text-xs text-muted-foreground">{darkMode ? 'Switch to light' : 'Switch to dark'}</p>
                </div>
              </div>
              <div className={`h-6 w-10 rounded-full relative transition-colors ${darkMode ? 'bg-primary' : 'bg-gray-300'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${darkMode ? 'right-1' : 'left-1'}`} />
              </div>
            </div>

            <div className="p-4 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <Type className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Text Size</p>
                  <p className="text-xs text-muted-foreground">Adjust how large text appears</p>
                </div>
              </div>
              <div className="flex gap-2">
                {TEXT_SIZES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => changeFontSize(s.value)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                      ${fontSize === s.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:bg-accent'}`}
                  >
                    {s.label}
                  </button>
                ))}
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

            {/* Privacy Policy – open static HTML in new tab */}
            <a
              href="/Privacy%20Policy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Privacy Policy</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </a>

            {/* Terms of Service – open static HTML in new tab */}
            <a
              href="/Terms%20and%20Conditions.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Terms of Service</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </a>

            <div className="flex items-center justify-between p-4 rounded-xl cursor-pointer hover:bg-accent transition-colors" onClick={() => navigate('/contact', { state: { customerCode: user?.customer_code, userName: user?.full_name, userEmail: user?.email } })}>
              <div className="flex items-center gap-3">
                <LifeBuoy className="w-5 h-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Contact Support</p>
                  <p className="text-xs text-muted-foreground">Get help from our team</p>
                </div>
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
        <TabsContent value="credits">
          <div className="space-y-4">
            <CreditBalanceWidget />
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
              {/* Domain re-registration hint */}
              {signInMethod === 'biometric' && (
                <div className="mt-3 ml-8 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground">
                    Using a new browser or device? Switch to Password and then back to Biometric to re-register your fingerprint here.
                  </p>
                </div>
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

            {/* ── Delete account ── */}
            <div className="p-4 rounded-xl bg-card border border-destructive/30">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => {
                  setShowDeleteSection(!showDeleteSection);
                  setDeleteConfirmText('');
                  setDeletePassword('');
                  setDeleteVerified(false);
                  setBiometricFallback(false);
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
                        {/* Biometric fallback notice */}
                        {biometricFallback && (
                          <div className="flex items-start gap-1.5 pl-6">
                            <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              Your fingerprint isn't registered on this browser. Enter your password instead.
                            </p>
                          </div>
                        )}

                        {/* Biometric button — shown for biometric users when no fallback yet */}
                        {signInMethod === 'biometric' && !biometricFallback && (
                          <p className="text-xs text-muted-foreground pl-6">
                            Scan your fingerprint to confirm it's really you before we delete anything.
                          </p>
                        )}

                        {/* Password input — always shown for password users, or after biometric fallback */}
                        {deleteUsesPassword && (
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
                          disabled={verifying || (deleteUsesPassword && !deletePassword)}
                        >
                          {verifying
                            ? <><Loader2 className="w-3 h-3 animate-spin" /> Verifying…</>
                            : !deleteUsesPassword
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

        {/* ── Admin tab ── */}
        {isAdmin && (
          <TabsContent value="admin">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">User Management</h3>
                  <p className="text-xs text-muted-foreground">{adminUsers.length > 0 ? `${adminUsers.length} total users` : 'Verify, manage and blacklist users'}</p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchAdminUsers} disabled={loadingAdminUsers} className="gap-1.5">
                  {loadingAdminUsers ? <Loader2 className="w-3 h-3 animate-spin" /> : '↻'} Refresh
                </Button>
              </div>

              <Input
                placeholder="Search by email, name or customer code…"
                value={adminFilter}
                onChange={e => setAdminFilter(e.target.value)}
                className="text-sm"
              />

              {loadingAdminUsers && (
                <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
                </div>
              )}

              {!loadingAdminUsers && adminUsers.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  No users yet. Click Refresh to load.
                </p>
              )}

              <div className="space-y-3">
                {adminUsers
                  .filter(u => {
                    const q = adminFilter.toLowerCase();
                    return !q
                      || (u.email || '').toLowerCase().includes(q)
                      || (u.full_name || '').toLowerCase().includes(q)
                      || (u.customer_code || '').toLowerCase().includes(q);
                  })
                  .map(u => (
                    <Card key={u.id} className={`p-3 space-y-2 ${u.blacklisted ? 'border-red-300 bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{u.full_name || '—'}</p>
                            {u.blacklisted && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">⛔ BLACKLISTED</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          {u.customer_code && (
                            <p className="text-xs font-mono text-primary mt-0.5">{u.customer_code}</p>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${u.verified ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'}`}>
                              {u.verified ? '✅ ID' : '⏳ ID'}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${u.licence_verified ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : u.license_pending ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                              {u.licence_verified ? '🛡️ Licence' : u.license_pending ? '⏳ Lic Pending' : '— Licence'}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">
                              <Coins className="w-2.5 h-2.5 inline mr-0.5" />{u.credit_balance ?? 0} cr
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 capitalize">
                              {u.account_type || 'n/a'}
                            </span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs shrink-0"
                          onClick={() => openAdminUser(u)}
                        >
                          <UserIcon className="w-3 h-3 mr-1" /> View
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-border/50">
                        <div className="grid grid-cols-3 gap-1.5">
                          <Button
                            size="sm"
                            variant={u.verified ? 'outline' : 'default'}
                            className="h-7 text-[10px] gap-0.5 px-1"
                            disabled={togglingId === u.id}
                            onClick={() => toggleVerified(u.id, u.verified)}
                          >
                            {togglingId === u.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <ShieldCheck className="w-3 h-3" />}
                            {u.verified ? 'Un-ID' : '✅ ID'}
                          </Button>
                          <Button
                            size="sm"
                            variant={u.licence_verified ? 'outline' : u.license_pending ? 'secondary' : 'default'}
                            className="h-7 text-[10px] gap-0.5 px-1"
                            disabled={togglingId === u.id + '_lic'}
                            onClick={() => toggleLicenceVerified(u.id, u.licence_verified, u.id_verified)}
                          >
                            {togglingId === u.id + '_lic'
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <FileText className="w-3 h-3" />}
                            {u.licence_verified ? 'Un-Lic' : u.license_pending ? '⏳ Approve' : '🛡️ Lic'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] gap-0.5 px-1"
                            disabled={togglingId === u.id + '_sub'}
                            onClick={() => addAdminCredits(u.id, 10)}
                          >
                            {togglingId === u.id + '_sub'
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Coins className="w-3 h-3" />}
                            +10 Cr
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant={u.blacklisted ? 'default' : 'outline'}
                          className={`h-7 text-[10px] gap-0.5 px-1 w-full ${u.blacklisted ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : 'text-red-600 border-red-300 hover:bg-red-50'}`}
                          disabled={blacklistingId === u.id}
                          onClick={() => blacklistUser(u.id, u.blacklisted)}
                        >
                          {blacklistingId === u.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                          {u.blacklisted ? 'Remove Blacklist' : '⛔ Blacklist User'}
                        </Button>
                      </div>
                    </Card>
                  ))}
              </div>
            </div>
          </TabsContent>
        )}

        {/* ── Admin User Detail / Edit Modal ── */}
        {isAdmin && adminSelectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setAdminSelectedUser(null)}>
            <div
              className="bg-card rounded-2xl shadow-xl w-full max-w-md border border-border flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">
                    {adminModalTab === 'edit' ? 'Edit Profile' : 'User Profile'}
                  </h3>
                  {adminSelectedUser.blacklisted && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">⛔ BLACKLISTED</span>
                  )}
                </div>
                <button onClick={() => setAdminSelectedUser(null)} className="text-muted-foreground hover:text-foreground">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Tab switcher */}
              <div className="flex border-b border-border shrink-0">
                <button
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${adminModalTab === 'view' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setAdminModalTab('view')}
                >
                  View Details
                </button>
                <button
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${adminModalTab === 'edit' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setAdminModalTab('edit')}
                >
                  Edit Profile
                </button>
              </div>

              <div className="overflow-y-auto flex-1 p-4">
                {adminModalTab === 'view' ? (
                  <div className="space-y-3">
                    {/* Identity */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Identity</p>
                      <div className="rounded-xl border border-border/50 divide-y divide-border/50">
                        {[
                          ['Full Name', adminSelectedUser.full_name || '—'],
                          ['Email', adminSelectedUser.email || '—'],
                          ['Customer Code', adminSelectedUser.customer_code || '—'],
                          ['Account Type', adminSelectedUser.account_type || '—'],
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between items-center px-3 py-2">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <span className="text-xs font-medium text-right ml-4 break-all">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Contact & Location */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Contact & Location</p>
                      <div className="rounded-xl border border-border/50 divide-y divide-border/50">
                        {[
                          ['Phone', adminSelectedUser.phone || '—'],
                          ['Location', adminSelectedUser.location || '—'],
                          ['Address', adminSelectedUser.residential_address || '—'],
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between items-center px-3 py-2">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <span className="text-xs font-medium text-right ml-4 break-all">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Licence */}
                    {(adminSelectedUser.license_number || adminSelectedUser.license_year) && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Driving Licence</p>
                        <div className="rounded-xl border border-border/50 divide-y divide-border/50">
                          {[
                            ['Licence Number', adminSelectedUser.license_number || '—'],
                            ['Year Issued', adminSelectedUser.license_year ? String(adminSelectedUser.license_year) : '—'],
                          ].map(([label, value]) => (
                            <div key={label} className="flex justify-between items-center px-3 py-2">
                              <span className="text-xs text-muted-foreground">{label}</span>
                              <span className="text-xs font-medium">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Status */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
                      <div className="rounded-xl border border-border/50 divide-y divide-border/50">
                        {[
                          ['Verified', adminSelectedUser.verified ? '✓ Yes' : '✗ No'],
                          ['Subscription', adminSelectedUser.subscription_active ? `Active — ${adminSelectedUser.subscription_plan || '?'}` : 'Inactive'],
                          ['Blacklisted', adminSelectedUser.blacklisted ? '⛔ Yes' : '✓ No'],
                          ['Member Since', adminSelectedUser.created_at ? new Date(adminSelectedUser.created_at).toLocaleDateString() : '—'],
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between items-center px-3 py-2">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <span className="text-xs font-medium">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Quick actions */}
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <Button
                        size="sm"
                        variant={adminSelectedUser.verified ? 'outline' : 'default'}
                        className="h-8 text-xs gap-1"
                        disabled={togglingId === adminSelectedUser.id}
                        onClick={() => toggleVerified(adminSelectedUser.id, adminSelectedUser.verified)}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        {adminSelectedUser.verified ? 'Unverify' : 'Verify'}
                      </Button>
                      <Button
                        size="sm"
                        variant={adminSelectedUser.subscription_active ? 'outline' : 'secondary'}
                        className="h-8 text-xs gap-1"
                        disabled={togglingId === adminSelectedUser.id + '_sub'}
                        onClick={() => toggleSubscription(adminSelectedUser.id, adminSelectedUser.subscription_active, adminSelectedUser.subscription_plan)}
                      >
                        <Crown className="w-3 h-3" />
                        {adminSelectedUser.subscription_active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="sm"
                        variant={adminSelectedUser.blacklisted ? 'default' : 'outline'}
                        className={`h-8 text-xs gap-1 ${adminSelectedUser.blacklisted ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : 'text-red-600 border-red-300 hover:bg-red-50'}`}
                        disabled={blacklistingId === adminSelectedUser.id}
                        onClick={() => blacklistUser(adminSelectedUser.id, adminSelectedUser.blacklisted)}
                      >
                        {adminSelectedUser.blacklisted ? 'Unban' : '⛔ Ban'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Edit tab */
                  adminEditForm && (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">Full Name</Label>
                        <Input className="mt-1" value={adminEditForm.full_name} onChange={e => setAdminEditForm(f => ({ ...f, full_name: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">Phone</Label>
                        <Input className="mt-1" value={adminEditForm.phone} onChange={e => setAdminEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="+27..." />
                      </div>
                      <div>
                        <Label className="text-xs">Location</Label>
                        <Input className="mt-1" value={adminEditForm.location} onChange={e => setAdminEditForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Soweto, Gauteng" />
                      </div>
                      <div>
                        <Label className="text-xs">Residential Address</Label>
                        <Input className="mt-1" value={adminEditForm.residential_address} onChange={e => setAdminEditForm(f => ({ ...f, residential_address: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">Account Type</Label>
                        <select
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                          value={adminEditForm.account_type}
                          onChange={e => setAdminEditForm(f => ({ ...f, account_type: e.target.value }))}
                        >
                          <option value="driver">Driver</option>
                          <option value="owner">Owner</option>
                          <option value="both">Fleet Pro (Both)</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Licence Number</Label>
                          <Input className="mt-1" value={adminEditForm.license_number} onChange={e => setAdminEditForm(f => ({ ...f, license_number: e.target.value }))} placeholder="e.g. DL1234567" />
                        </div>
                        <div>
                          <Label className="text-xs">Year Issued</Label>
                          <Input className="mt-1" type="number" value={adminEditForm.license_year} onChange={e => setAdminEditForm(f => ({ ...f, license_year: e.target.value }))} placeholder="e.g. 2018" />
                        </div>
                      </div>
                      <Button className="w-full gap-2 mt-2" onClick={saveAdminEdit} disabled={adminSaving}>
                        {adminSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save Changes'}
                      </Button>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}

      </Tabs>
    </div>
  );
}