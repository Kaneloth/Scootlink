import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, supabase, saveBiometricRefreshToken } from '@/api/supabaseData';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Moon, Sun, ChevronRight, ChevronDown, ChevronUp, LogOut, User as UserIcon, Bell, Globe, Shield, FileText,
  Crown, Bike, Users, CheckCircle2, Loader2, ArrowRight, Lock, Fingerprint, Trash2,
  AlertTriangle, ShieldCheck, XCircle, Info, Type, LifeBuoy, Copy, Upload, Coins, Star,
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
  { id: 'starter',  credits: 240,  price: 49  },
  { id: 'standard', credits: 400,  price: 79,  popular: true },
  { id: 'pro',      credits: 660,  price: 129 },
  { id: 'business', credits: 1040, price: 199 },
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
const CREDIT_COSTS = [
  { icon: '💬', action: 'Start a chat',                    cost: '50 credits'  },
  { icon: '🚗', action: 'List a vehicle (1st)',             cost: '250 credits' },
  { icon: '🚗', action: 'List a vehicle (2nd)',             cost: '200 credits' },
  { icon: '🚗', action: 'List a vehicle (3rd+)',            cost: '175 credits' },
  { icon: '📝', action: 'Sign a rental contract',           cost: '200 credits' },
];

function CreditBalanceWidget() {
  const { balance, loading, refetch } = useCredits();
  const [purchasing,  setPurchasing]  = React.useState(null);
  const [selectedPkg, setSelectedPkg] = React.useState(
    CREDIT_PACKAGES.find(p => p.popular)?.id || CREDIT_PACKAGES[1].id
  );
  const [showCosts, setShowCosts] = React.useState(false);

  const handlePurchase = async () => {
    const pkg = CREDIT_PACKAGES.find(p => p.id === selectedPkg);
    if (!pkg) return;
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

  const selected = CREDIT_PACKAGES.find(p => p.id === selectedPkg);

  return (
    <div className="space-y-5">
      {/* Balance */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-primary/5 border border-primary/20">
        <div>
          <p className="text-xs text-muted-foreground">Your credit balance</p>
          {loading
            ? <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mt-1" />
            : <p className="text-3xl font-bold text-primary">{balance}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">credits · never expire</p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Coins className="w-6 h-6 text-primary" />
        </div>
      </div>

      {/* Packages */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Choose a package</p>
        <div className="space-y-2.5">
          {CREDIT_PACKAGES.map(pkg => {
            const isSelected = selectedPkg === pkg.id;
            return (
              <button
                key={pkg.id}
                onClick={() => setSelectedPkg(pkg.id)}
                disabled={purchasing !== null}
                className={`w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all disabled:opacity-60 ${
                  isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-primary/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-primary' : 'border-muted-foreground/40'}`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-xl font-extrabold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                        {pkg.credits.toLocaleString()}
                      </span>
                      <span className="text-sm text-muted-foreground font-medium">credits</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {pkg.popular && (
                      <span className="text-[10px] font-bold bg-primary text-white px-2 py-0.5 rounded-full">🔥 POPULAR</span>
                    )}
                    <span className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-foreground'}`}>R{pkg.price}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pay button */}
      <Button onClick={handlePurchase} disabled={purchasing !== null} className="w-full h-12 text-base font-bold rounded-2xl gap-2">
        {purchasing
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
          : <>Pay R{selected?.price} — Get {selected?.credits.toLocaleString()} credits</>}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground -mt-3">
        Secure payment via card or EFT · Credits added instantly
      </p>

      {/* How far your credits go — collapsible */}
      <div className="border border-border rounded-2xl overflow-hidden">
        <button onClick={() => setShowCosts(v => !v)} className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-muted/40 transition-colors">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How far your credits go</p>
          {showCosts ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showCosts && (
          <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
            {CREDIT_COSTS.map(({ icon, action, cost }) => (
              <div key={action} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{icon}</span>
                  <p className="text-xs text-muted-foreground">{action}</p>
                </div>
                <span className="text-xs font-semibold text-foreground shrink-0 ml-2">{cost}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-border">
              <p className="text-[11px] text-muted-foreground text-center">Credits never expire · Sign-up bonus included</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Platform Verification Queue (admin) ──────────────────────────────────────
// Reviews driver-submitted platform-rating verification requests (free,
// manual review). Approving/rejecting writes directly via the client's own
// session — RLS on platform_history should allow admins to update any row
// (add an admin-checking RLS policy, or route this through a service-role
// Netlify function if you'd rather not grant that via RLS).
function PlatformVerificationQueue() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});
  const [evidenceIssues, setEvidenceIssues] = useState({}); // entry.id -> reason string
  const [rejectingId, setRejectingId] = useState(null); // entry.id currently showing the reason picker
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonOther, setRejectReasonOther] = useState('');

  const REJECTION_REASONS = [
    'Rating does not match evidence',
    'Screenshot is not from this platform',
    'Screenshot is blurry or unreadable',
    'Platform name does not match screenshot',
    'Other',
  ];

  const fetchPending = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('platform_history')
      .select('*, profiles!user_id(full_name, email)')
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: true });
    if (!error) {
      setPending(data || []);
      // Generate signed URLs for each evidence screenshot (private bucket)
      const urls = {};
      const issues = {};
      await Promise.all((data || []).map(async (entry) => {
        if (!entry.evidence_url) {
          issues[entry.id] = 'No screenshot was attached to this request.';
          return;
        }
        const { data: signed, error: signErr } = await supabase.storage
          .from('platform-evidence')
          .createSignedUrl(entry.evidence_url, 600); // 10 min
        if (signed?.signedUrl) {
          urls[entry.id] = signed.signedUrl;
        } else {
          console.warn('[PlatformVerificationQueue] createSignedUrl failed:', entry.id, signErr);
          issues[entry.id] = 'Could not load the screenshot (' + (signErr?.message || 'unknown error') + ').';
        }
      }));
      setSignedUrls(urls);
      setEvidenceIssues(issues);
    } else {
      toast.error('Could not load verification queue: ' + error.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchPending(); }, []);

  const handleReview = async (entry, approve, reason = null) => {
    setProcessingId(entry.id);
    const { data: { user: adminUser } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('platform_history')
      .update({
        verification_status: approve ? 'verified' : 'rejected',
        rejection_reason: approve ? null : reason,
        reviewed_by: adminUser?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', entry.id);
    if (error) {
      toast.error('Failed to update: ' + error.message);
    } else {
      toast.success(approve ? 'Platform history approved' : 'Platform history rejected');
      setPending(prev => prev.filter(p => p.id !== entry.id));
      setRejectingId(null);
      setRejectReason('');
      setRejectReasonOther('');
    }
    setProcessingId(null);
  };

  const confirmReject = (entry) => {
    const finalReason = rejectReason === 'Other' ? rejectReasonOther.trim() : rejectReason;
    if (!finalReason) { toast.error('Please select or enter a rejection reason'); return; }
    handleReview(entry, false, finalReason);
  };

  return (
    <div className="space-y-3 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Platform Verification Queue</h3>
          <p className="text-xs text-muted-foreground">{pending.length > 0 ? `${pending.length} pending request${pending.length !== 1 ? 's' : ''}` : 'Free, manual review of driver platform ratings'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchPending} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : '↻'} Refresh
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && pending.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-6 border border-dashed border-border rounded-xl">
          No pending platform verification requests.
        </p>
      )}

      <div className="space-y-3">
        {pending.map(entry => (
          <Card key={entry.id} className="p-4 border border-border/50">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold text-sm">{entry.profiles?.full_name || 'Unknown user'}</p>
                <p className="text-xs text-muted-foreground">{entry.profiles?.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-semibold text-sm">{entry.platform}</span>
                <span className="flex items-center gap-0.5 text-amber-500 text-xs font-semibold">
                  <Star className="w-3.5 h-3.5 fill-current" /> {Number(entry.rating).toFixed(1)}
                </span>
              </div>
            </div>

            {signedUrls[entry.id] ? (
              <img
                src={signedUrls[entry.id]}
                alt="Evidence screenshot"
                className="w-full max-h-64 object-contain rounded-lg border border-border mb-3 bg-muted"
              />
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 text-xs mb-3 border border-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {evidenceIssues[entry.id] || 'No screenshot available for this request.'}
              </div>
            )}

            {rejectingId === entry.id ? (
              <div className="space-y-2 border border-border rounded-xl p-3">
                <p className="text-xs font-semibold">Reason for rejection</p>
                <Select value={rejectReason} onValueChange={setRejectReason}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                  <SelectContent>
                    {REJECTION_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                {rejectReason === 'Other' && (
                  <Input
                    placeholder="Type the reason…"
                    value={rejectReasonOther}
                    onChange={e => setRejectReasonOther(e.target.value)}
                    className="text-sm"
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 gap-1.5"
                    disabled={processingId === entry.id}
                    onClick={() => confirmReject(entry)}
                  >
                    {processingId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                    Confirm Rejection
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setRejectingId(null); setRejectReason(''); setRejectReasonOther(''); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 gap-1.5"
                  disabled={processingId === entry.id}
                  onClick={() => handleReview(entry, true)}
                >
                  {processingId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 gap-1.5"
                  disabled={processingId === entry.id}
                  onClick={() => setRejectingId(entry.id)}
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </Button>
              </div>
            )}
          </Card>
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
  // Credits tab stays hidden until the user's first real purchase — part of
  // the "app feels free" strategy: don't surface the credit/payment system
  // before someone has actually engaged with it.
  const [hasPurchasedCredits, setHasPurchasedCredits] = useState(false);
  const [notifications, setNotifications] = useState(() =>
    localStorage.getItem('scootlink_notifications') !== 'false'
  );
  const [biometricLoading, setBiometricLoading] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  // true when the account was created via Google OAuth (no existing password)
  const [isGoogleUser, setIsGoogleUser] = useState(false);

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
  const [banningId, setBanningId] = useState(null);
  const [suspendingId, setSuspendingId] = useState(null);
  const [suspendPickerId, setSuspendPickerId] = useState(null); // user id currently showing the duration picker
  const [banPickerId, setBanPickerId] = useState(null); // user id currently showing the ban-reason picker
  const [banReason, setBanReason] = useState('');
  const [banReasonOther, setBanReasonOther] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendReasonOther, setSuspendReasonOther] = useState('');

  const MODERATION_REASONS = [
    'Fraudulent activity',
    'Fake or duplicate account',
    'Harassment or abusive behaviour',
    'Violation of Terms of Service',
    'Payment or chargeback dispute',
    'Safety concern reported by another user',
    'Other',
  ];
  const [adminSelectedUser, setAdminSelectedUser] = useState(null); // user open in detail/edit modal
  const [adminEditForm, setAdminEditForm] = useState(null);          // edit form state
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState('view');        // 'view' | 'edit'

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
    // Check for at least one real purchase (not the signup bonus) to decide
    // whether the Credits tab should be visible at all.
    supabase.auth.getUser().then(async ({ data: { user: authUser } }) => {
      if (!authUser) return;
      const { data } = await supabase
        .from('credit_ledger')
        .select('id')
        .eq('user_id', authUser.id)
        .eq('type', 'purchase')
        .limit(1)
        .maybeSingle();
      setHasPurchasedCredits(!!data);
      if (!data && activeTab === 'credits') setActiveTab('general');
    });
    // Detect Google OAuth users — they have no password so we show "Create" instead of "Change"
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      const identities = authUser?.identities ?? [];
      const isGoogle = identities.some(i => i.provider === 'google') &&
                       !identities.some(i => i.provider === 'email');
      setIsGoogleUser(isGoogle);
    }).catch(() => {});
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
      .select('id, email, full_name, verified, id_verified, licence_verified, license_pending, verification_badge, account_type, customer_code, phone, location, residential_address, license_number, license_year, blacklisted, banned, suspended_until, ban_reason, suspension_reason, id_document_number, id_document_type, created_at')
      .order('created_at', { ascending: false });
    if (!error) {
      // Fetch credit balances for each user via the same RPC the app uses for
      // a user's own balance (SQL-side SUM — not subject to PostgREST's
      // default 1000-row cap, unlike pulling all credit_ledger rows client-side).
      const userIds = (data || []).map(u => u.id);
      let creditMap = {};
      if (userIds.length > 0) {
        const results = await Promise.all(
          userIds.map(async (id) => {
            const { data: bal, error: balErr } = await supabase.rpc('get_credit_balance', { p_user_id: id });
            return [id, balErr ? 0 : (bal ?? 0)];
          })
        );
        results.forEach(([id, bal]) => { creditMap[id] = bal; });
      }
      // Exclude the currently logged-in admin's own row — an admin should
      // never be able to accidentally ban/suspend themselves from this list.
      const filtered = (data || []).filter(u => u.id !== user?.id);
      setAdminUsers(filtered.map(u => ({ ...u, credit_balance: creditMap[u.id] ?? 0 })));
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

  const subtractAdminCredits = async (userId, amount) => {
    setTogglingId(userId + '_subtract');
    const { error } = await supabase.rpc('add_credits', {
      p_user_id:     userId,
      p_amount:      -amount,
      p_type:        'adjustment',
      p_description: `Admin credit adjustment`,
      p_ref_id:      `admin:${userId}`,
    });
    if (!error) {
      toast.success(`Subtracted ${amount} credits from user`);
    } else {
      toast.error('Failed to subtract credits: ' + error.message);
    }
    setTogglingId(null);
  };

  const toggleAdminRole = async (userId, currentIsAdmin) => {
    setTogglingId(userId + '_admin');
    const granting = !currentIsAdmin;
    try {
      const { error: profileErr } = await supabase.from('profiles').update({ is_admin: granting }).eq('id', userId);
      if (profileErr) throw profileErr;
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (accessToken) {
        await fetch('/.netlify/functions/admin-set-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ userId, is_admin: granting }),
        });
      }
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, is_admin: granting } : u));
      if (adminSelectedUser?.id === userId) setAdminSelectedUser(p => ({ ...p, is_admin: granting }));
      toast.success(granting ? '✅ Admin rights granted' : 'Admin rights removed');
    } catch (err) { toast.error('Failed to update admin role: ' + err.message); }
    setTogglingId(null);
  };

  // ── Ban (permanent, until an admin reverses it) ───────────────────────────
  const banUser = async (userId, currentlyBanned, reason = null) => {
    setBanningId(userId);
    const banning = !currentlyBanned;

    const { error } = await supabase
      .from('profiles')
      .update({ banned: banning, ban_reason: banning ? reason : null })
      .eq('id', userId);

    if (error) {
      toast.error('Failed to update ban status: ' + (error.message || 'unknown error'));
      setBanningId(null);
      return;
    }

    // Permanent ID/passport blacklist stays tied to Ban specifically — a
    // suspension is meant to expire, so it never touches this table.
    const { data: sensitiveRow } = await supabase
      .from('user_sensitive_info')
      .select('sa_id, passport')
      .eq('user_id', userId)
      .maybeSingle();
    const idNum = (sensitiveRow?.sa_id || sensitiveRow?.passport || '').trim().toUpperCase();
    if (idNum) {
      if (banning) {
        await supabase.from('blacklisted_id_numbers').upsert({ id_number: idNum }, { onConflict: 'id_number' });
      } else {
        await supabase.from('blacklisted_id_numbers').delete().eq('id_number', idNum);
      }
    }

    // Ban/unban at the Supabase Auth level too, for immediate session
    // revocation. Safe to do unconditionally here since a ban is meant to be
    // permanent anyway (unlike suspend, where we deliberately avoid this —
    // see suspendUser below).
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (accessToken) {
        await fetch('/.netlify/functions/admin-ban-user', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ userId, ban: banning }),
        });
      }
    } catch {
      // Non-fatal — profiles.banned still blocks app access on next login attempt
    }

    setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, banned: banning, ban_reason: banning ? reason : null } : u));
    if (adminSelectedUser?.id === userId) setAdminSelectedUser(p => ({ ...p, banned: banning, ban_reason: banning ? reason : null }));
    toast.success(banning ? 'User banned ⛔' : 'User unbanned ✓');
    setBanningId(null);
    setBanPickerId(null);
  };

  // ── Suspend (temporary, self-expiring) ────────────────────────────────────
  // Deliberately does NOT call admin-ban-user or touch blacklisted_id_numbers —
  // both of those are effectively permanent locks, which would defeat a
  // suspension's whole point of automatically expiring. Enforcement instead
  // relies entirely on the is_user_blocked() check at login time (Auth.jsx),
  // which compares suspended_until against now() on every attempt.
  // NOTE: because we skip admin-ban-user, an already-open session for the
  // user being suspended won't be forcibly kicked out immediately — they'll
  // be blocked on their next sign-in, not mid-session. Flagging this as a
  // known limitation rather than a silent gap.
  const suspendUser = async (userId, days, reason) => {
    setSuspendingId(userId);
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from('profiles').update({ suspended_until: until, suspension_reason: reason }).eq('id', userId);
    if (error) {
      toast.error('Failed to suspend: ' + (error.message || 'unknown error'));
    } else {
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, suspended_until: until, suspension_reason: reason } : u));
      if (adminSelectedUser?.id === userId) setAdminSelectedUser(p => ({ ...p, suspended_until: until, suspension_reason: reason }));
      toast.success(`User suspended for ${days} day${days !== 1 ? 's' : ''} ⏳`);
    }
    setSuspendingId(null);
    setSuspendPickerId(null);
    setSuspendReason('');
    setSuspendReasonOther('');
  };

  const unsuspendUser = async (userId) => {
    setSuspendingId(userId);
    const { error } = await supabase.from('profiles').update({ suspended_until: null, suspension_reason: null }).eq('id', userId);
    if (error) {
      toast.error('Failed to unsuspend: ' + (error.message || 'unknown error'));
    } else {
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, suspended_until: null, suspension_reason: null } : u));
      if (adminSelectedUser?.id === userId) setAdminSelectedUser(p => ({ ...p, suspended_until: null, suspension_reason: null }));
      toast.success('User unsuspended ✓');
    }
    setSuspendingId(null);
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
    if (isGoogleUser) {
      // Google users have no existing password — only need new + confirm
      if (!newPassword || !confirmPassword) { setPasswordError('Fill all fields'); return; }
    } else {
      if (!currentPassword || !newPassword || !confirmPassword) { setPasswordError('Fill all fields'); return; }
    }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return; }
    if (newPassword.length < 6) { setPasswordError('Min 6 characters'); return; }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success(isGoogleUser ? 'Password created! You can now sign in with email & password.' : 'Password updated!');
      setShowPasswordForm(false);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      try {
        if (user?.phone) {
          await sendSMS(user.phone, `Your Skootlink password was just ${isGoogleUser ? 'created' : 'changed'}. If this wasn't you, contact support immediately at help@skootlink.co.za.`);
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
        <TabsList className={`grid w-full mb-6`} style={{ gridTemplateColumns: `repeat(${2 + (hasPurchasedCredits ? 1 : 0) + (isAdmin ? 1 : 0)}, minmax(0, 1fr))` }}>
          <TabsTrigger value="general">General</TabsTrigger>
          {hasPurchasedCredits && <TabsTrigger value="credits">Credits</TabsTrigger>}
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
                    <p className="text-sm font-medium">{isGoogleUser ? 'Create Password' : 'Change Password'}</p>
                    <p className="text-xs text-muted-foreground">
                      {isGoogleUser
                        ? showPasswordForm ? 'Hide form' : 'Add a password to your Google account'
                        : showPasswordForm ? 'Hide form' : 'Update your password'}
                    </p>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 transition-transform ${showPasswordForm ? 'rotate-90' : ''}`} />
              </div>
              {showPasswordForm && (
                <div className="mt-4 space-y-3 pt-4 border-t">
                  {isGoogleUser && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">
                        Your account uses Google sign-in. You can create a password here to also be able to sign in with your email and password.
                      </p>
                    </div>
                  )}
                  {!isGoogleUser && (
                    <div>
                      <Label className="text-xs">Current Password</Label>
                      <Input type="password" placeholder="..." value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                    </div>
                  )}
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
                    {isGoogleUser ? 'Create Password' : 'Update Password'}
                  </Button>
                </div>
              )}
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
            <PlatformVerificationQueue />
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
                    <Card key={u.id} className={`p-3 space-y-2 ${u.banned ? 'border-red-300 bg-red-50/40 dark:bg-red-900/10' : (u.suspended_until && new Date(u.suspended_until) > new Date()) ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-900/10' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{u.full_name || '—'}</p>
                            {u.banned && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">⛔ BANNED</span>
                            )}
                            {!u.banned && u.suspended_until && new Date(u.suspended_until) > new Date() && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">⏳ SUSPENDED</span>
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
                        <div className="grid grid-cols-4 gap-1.5">
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
                            onClick={() => addAdminCredits(u.id, 50)}
                          >
                            {togglingId === u.id + '_sub'
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Coins className="w-3 h-3" />}
                            +50 Cr
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] gap-0.5 px-1"
                            disabled={togglingId === u.id + '_subtract'}
                            onClick={() => subtractAdminCredits(u.id, 50)}
                          >
                            {togglingId === u.id + '_subtract'
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Coins className="w-3 h-3" />}
                            -50 Cr
                          </Button>
                        </div>
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant={u.banned ? 'default' : 'outline'}
                            className={`h-7 text-[10px] gap-0.5 px-1 flex-1 ${u.banned ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : 'text-red-600 border-red-300 hover:bg-red-50'}`}
                            disabled={banningId === u.id}
                            onClick={() => u.banned ? banUser(u.id, u.banned) : setBanPickerId(banPickerId === u.id ? null : u.id)}
                          >
                            {banningId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            {u.banned ? 'Unban' : '⛔ Ban'}
                          </Button>
                          {u.suspended_until && new Date(u.suspended_until) > new Date() ? (
                            <Button
                              size="sm"
                              className="h-7 text-[10px] gap-0.5 px-1 flex-1 bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                              disabled={suspendingId === u.id}
                              onClick={() => unsuspendUser(u.id)}
                            >
                              {suspendingId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Unsuspend
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-0.5 px-1 flex-1 text-amber-600 border-amber-300 hover:bg-amber-50"
                              disabled={suspendingId === u.id}
                              onClick={() => setSuspendPickerId(suspendPickerId === u.id ? null : u.id)}
                            >
                              ⏳ Suspend
                            </Button>
                          )}
                        </div>

                        {/* Ban reason picker */}
                        {banPickerId === u.id && (
                          <div className="space-y-1.5 border border-red-200 rounded-lg p-2 bg-red-50/50">
                            <Select value={banReason} onValueChange={setBanReason}>
                              <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                              <SelectContent>
                                {MODERATION_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {banReason === 'Other' && (
                              <Input
                                placeholder="Type the reason…"
                                value={banReasonOther}
                                onChange={e => setBanReasonOther(e.target.value)}
                                className="h-7 text-[10px]"
                              />
                            )}
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                className="h-6 text-[9px] flex-1 bg-red-600 hover:bg-red-700 text-white"
                                disabled={banningId === u.id}
                                onClick={() => {
                                  const finalReason = banReason === 'Other' ? banReasonOther.trim() : banReason;
                                  if (!finalReason) { toast.error('Please select or enter a reason'); return; }
                                  banUser(u.id, u.banned, finalReason);
                                }}
                              >
                                Confirm Ban
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[9px] flex-1"
                                onClick={() => { setBanPickerId(null); setBanReason(''); setBanReasonOther(''); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Suspend reason + duration picker */}
                        {suspendPickerId === u.id && (
                          <div className="space-y-1.5 border border-amber-200 rounded-lg p-2 bg-amber-50/50">
                            <Select value={suspendReason} onValueChange={setSuspendReason}>
                              <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                              <SelectContent>
                                {MODERATION_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {suspendReason === 'Other' && (
                              <Input
                                placeholder="Type the reason…"
                                value={suspendReasonOther}
                                onChange={e => setSuspendReasonOther(e.target.value)}
                                className="h-7 text-[10px]"
                              />
                            )}
                            <p className="text-[9px] font-semibold text-amber-700">Duration:</p>
                            <div className="flex gap-1">
                              {[1, 3, 7, 30].map(days => (
                                <Button
                                  key={days}
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[9px] flex-1 px-0.5"
                                  disabled={suspendingId === u.id}
                                  onClick={() => {
                                    const finalReason = suspendReason === 'Other' ? suspendReasonOther.trim() : suspendReason;
                                    if (!finalReason) { toast.error('Please select or enter a reason'); return; }
                                    suspendUser(u.id, days, finalReason);
                                  }}
                                >
                                  {days}d
                                </Button>
                              ))}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[9px] w-full"
                              onClick={() => { setSuspendPickerId(null); setSuspendReason(''); setSuspendReasonOther(''); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                        {u.suspended_until && new Date(u.suspended_until) > new Date() && (
                          <p className="text-[9px] text-amber-600 text-center">
                            Suspended until {new Date(u.suspended_until).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                            {u.suspension_reason && ` · ${u.suspension_reason}`}
                          </p>
                        )}
                        {u.banned && u.ban_reason && (
                          <p className="text-[9px] text-red-600 text-center">Reason: {u.ban_reason}</p>
                        )}
                      </div>
                    </Card>
                  ))}
              </div>
            </div>
          </TabsContent>
        )}

        {/* ── Admin User Detail / Edit Modal ── */}
        {isAdmin && adminSelectedUser && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50" onClick={() => setAdminSelectedUser(null)}>
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
                  {adminSelectedUser.banned && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">⛔ BANNED</span>
                  )}
                  {!adminSelectedUser.banned && adminSelectedUser.suspended_until && new Date(adminSelectedUser.suspended_until) > new Date() && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">⏳ SUSPENDED</span>
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
                          ['Banned', adminSelectedUser.banned ? '⛔ Yes' : '✓ No'],
                          ...(adminSelectedUser.banned && adminSelectedUser.ban_reason ? [['Ban Reason', adminSelectedUser.ban_reason]] : []),
                          ['Suspended', (adminSelectedUser.suspended_until && new Date(adminSelectedUser.suspended_until) > new Date())
                            ? `⏳ Until ${new Date(adminSelectedUser.suspended_until).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}`
                            : '✓ No'],
                          ...((adminSelectedUser.suspended_until && new Date(adminSelectedUser.suspended_until) > new Date() && adminSelectedUser.suspension_reason) ? [['Suspend Reason', adminSelectedUser.suspension_reason]] : []),
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
                    <div className="grid grid-cols-2 gap-2 pt-1">
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
                        variant={adminSelectedUser.banned ? 'default' : 'outline'}
                        className={`h-8 text-xs gap-1 ${adminSelectedUser.banned ? 'bg-red-600 hover:bg-red-700 text-white border-red-600' : 'text-red-600 border-red-300 hover:bg-red-50'}`}
                        disabled={banningId === adminSelectedUser.id}
                        onClick={() => adminSelectedUser.banned ? banUser(adminSelectedUser.id, adminSelectedUser.banned) : setBanPickerId(banPickerId === adminSelectedUser.id ? null : adminSelectedUser.id)}
                      >
                        {adminSelectedUser.banned ? 'Unban' : '⛔ Ban'}
                      </Button>
                      {adminSelectedUser.suspended_until && new Date(adminSelectedUser.suspended_until) > new Date() ? (
                        <Button
                          size="sm"
                          className="h-8 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                          disabled={suspendingId === adminSelectedUser.id}
                          onClick={() => unsuspendUser(adminSelectedUser.id)}
                        >
                          Unsuspend
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1 text-amber-600 border-amber-300 hover:bg-amber-50"
                          disabled={suspendingId === adminSelectedUser.id}
                          onClick={() => setSuspendPickerId(suspendPickerId === adminSelectedUser.id ? null : adminSelectedUser.id)}
                        >
                          ⏳ Suspend
                        </Button>
                      )}

                      {/* Ban reason picker */}
                      {banPickerId === adminSelectedUser.id && (
                        <div className="col-span-2 space-y-1.5 border border-red-200 rounded-lg p-2 bg-red-50/50">
                          <Select value={banReason} onValueChange={setBanReason}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                            <SelectContent>
                              {MODERATION_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {banReason === 'Other' && (
                            <Input placeholder="Type the reason…" value={banReasonOther} onChange={e => setBanReasonOther(e.target.value)} className="h-8 text-xs" />
                          )}
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="h-7 text-xs flex-1 bg-red-600 hover:bg-red-700 text-white"
                              disabled={banningId === adminSelectedUser.id}
                              onClick={() => {
                                const finalReason = banReason === 'Other' ? banReasonOther.trim() : banReason;
                                if (!finalReason) { toast.error('Please select or enter a reason'); return; }
                                banUser(adminSelectedUser.id, adminSelectedUser.banned, finalReason);
                              }}
                            >
                              Confirm Ban
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs flex-1" onClick={() => { setBanPickerId(null); setBanReason(''); setBanReasonOther(''); }}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Suspend reason + duration picker */}
                      {suspendPickerId === adminSelectedUser.id && (
                        <div className="col-span-2 space-y-1.5 border border-amber-200 rounded-lg p-2 bg-amber-50/50">
                          <Select value={suspendReason} onValueChange={setSuspendReason}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                            <SelectContent>
                              {MODERATION_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {suspendReason === 'Other' && (
                            <Input placeholder="Type the reason…" value={suspendReasonOther} onChange={e => setSuspendReasonOther(e.target.value)} className="h-8 text-xs" />
                          )}
                          <p className="text-[10px] font-semibold text-amber-700">Duration:</p>
                          <div className="flex gap-1">
                            {[1, 3, 7, 30].map(days => (
                              <Button
                                key={days}
                                size="sm"
                                variant="outline"
                                className="h-7 text-[10px] flex-1"
                                disabled={suspendingId === adminSelectedUser.id}
                                onClick={() => {
                                  const finalReason = suspendReason === 'Other' ? suspendReasonOther.trim() : suspendReason;
                                  if (!finalReason) { toast.error('Please select or enter a reason'); return; }
                                  suspendUser(adminSelectedUser.id, days, finalReason);
                                }}
                              >
                                {days} day{days !== 1 ? 's' : ''}
                              </Button>
                            ))}
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] w-full" onClick={() => { setSuspendPickerId(null); setSuspendReason(''); setSuspendReasonOther(''); }}>
                            Cancel
                          </Button>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant={adminSelectedUser.is_admin ? 'default' : 'outline'}
                        className={`h-8 text-xs gap-1 col-span-2 ${adminSelectedUser.is_admin ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'text-purple-600 border-purple-300 hover:bg-purple-50'}`}
                        disabled={togglingId === adminSelectedUser.id + '_admin'}
                        onClick={() => toggleAdminRole(adminSelectedUser.id, adminSelectedUser.is_admin)}
                      >
                        {togglingId === adminSelectedUser.id + '_admin' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        {adminSelectedUser.is_admin ? '👑 Remove Admin' : '👑 Make Admin'}
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