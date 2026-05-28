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
  AlertTriangle, ShieldCheck, XCircle, Info, Type, LifeBuoy, Copy, Upload,
} from 'lucide-react';
import { sendSMS } from '@/lib/sms';
import { toast } from 'sonner';

// ── Text size options ────────────────────────────────────────────────────────
const TEXT_SIZES = [
  { label: 'Normal', value: '16px' },
  { label: 'Large', value: '18px' },
  { label: 'X-Large', value: '20px' },
];

// ── Admin emails ─────────────────────────────────────────────────────────────
const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];

const PLANS = [
  {
    id: 'driver', name: 'Driver', price: 39, icon: Bike,
    features: ['Search & rent vehicles', 'GPS Tracking access', 'Wallet & payments', 'Up to 2 active rentals', 'Driver profile & reviews'],
  },
  {
    id: 'owner', name: 'Owner', price: 49, icon: Crown, popular: true,
    features: ['List unlimited vehicles', 'Find & hire drivers', 'Real-time GPS tracking', 'Wallet & payouts', 'Priority listing visibility', 'Owner analytics dashboard'],
  },
  {
    id: 'both', name: 'Fleet Pro', price: 59, icon: Users,
    features: ['Everything in Owner +', 'Unlimited active rentals', 'Drive other vehicles too', 'Multi-vehicle fleet management', 'Priority support', 'Advanced analytics'],
  },
];

// ── WebAuthn helpers ─────────────────────────────────────────────────────────
function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
async function registerBiometric(user) {
  // ... (unchanged) ...
}
async function verifyBiometric() {
  // ... (unchanged) ...
}

async function clearTokenCookie() {
  await fetch('/.netlify/functions/auth-clear-token', { method: 'POST', credentials: 'include' }).catch(() => {});
}

async function deleteAccount(accessToken) {
  // ... (unchanged) ...
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Settings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'general');
  const [darkMode, setDarkMode] = useState(false);
  const [fontSize, setFontSize] = useState('16px');
  const [signInMethod, setSignInMethod] = useState('password');
  const [selectedPlan, setSelectedPlan] = useState('driver');
  const [processingPlan, setProcessingPlan] = useState(false);
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState(true);
  const [biometricLoading, setBiometricLoading] = useState(false);

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Delete account
  const [showDeleteSection, setShowDeleteSection] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteVerified, setDeleteVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [biometricFallback, setBiometricFallback] = useState(false);

  // Admin panel
  const [adminUsers, setAdminUsers] = useState([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [adminFilter, setAdminFilter] = useState('');
  const [togglingId, setTogglingId] = useState(null);
  const [blacklistingId, setBlacklistingId] = useState(null);
  const [adminSelectedUser, setAdminSelectedUser] = useState(null);
  const [adminEditForm, setAdminEditForm] = useState(null);
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState('view');

  // Licence verification (still self-declared)
  const [licencePlanNumber, setLicencePlanNumber] = useState('');
  const [licencePlanYear, setLicencePlanYear] = useState('');
  const [licencePlanStatus, setLicencePlanStatus] = useState('idle');
  const [licencePlanMsg, setLicencePlanMsg] = useState('');

  // Identity document
  const [idDocType, setIdDocType] = useState('sa_id'); // 'sa_id' | 'passport'
  const [idDocNumber, setIdDocNumber] = useState('');
  const [idDocError, setIdDocError] = useState('');

  // Passport image upload state
  const [frontPassportFile, setFrontPassportFile] = useState(null);   // File object
  const [backPassportFile, setBackPassportFile] = useState(null);
  const frontInputRef = useRef(null);
  const backInputRef = useRef(null);

  // Identity verification (VerifyNow)
  const [verifyIdStatus, setVerifyIdStatus] = useState('idle'); // idle | verifying | verified | failed
  const [verifyIdMsg, setVerifyIdMsg] = useState('');

  // Cancel subscription
  const [showPlanCancelConfirm, setShowPlanCancelConfirm] = useState(false);
  const [cancellingPlan, setCancellingPlan] = useState(false);

  // ── Load user & settings ─────────────────────────────────────────────────
  useEffect(() => {
    const isDark = localStorage.getItem('theme') === 'dark';
    setDarkMode(isDark);
    document.documentElement.classList.toggle('dark', isDark);
    const savedSize = localStorage.getItem('scootlink_font_size') || '16px';
    setFontSize(savedSize);
    document.documentElement.style.fontSize = savedSize;
    setSignInMethod(localStorage.getItem('scootlink_signin_method') || 'password');
    setNotifications(localStorage.getItem('scootlink_notifications') !== 'false');
    loadUser().then(u => {
      setUser(u);
      const plan = u?.subscription_plan || u?.account_type || 'driver';
      setSelectedPlan(plan === 'both' ? 'both' : plan);
    }).catch(() => {});
  }, []);

  const loadUser = async () => {
    const u = await auth.me();
    if (u?.id) {
      const { data } = await supabase
        .from('profiles')
        .select('customer_code, verified, id_verified, licence_verified, verification_badge')
        .eq('id', u.id)
        .single();
      return { ...u, ...data };
    }
    return u;
  };

  // ── ID validation & UI helpers ────────────────────────────────────────────
  function ageFromSAId(idNum) { /* unchanged */ }

  const handleIdDocChange = (val) => {
    setIdDocNumber(val);
    setIdDocError('');
    if (idDocType === 'sa_id') {
      const clean = val.replace(/\s/g, '');
      if (clean.length === 13) {
        const age = ageFromSAId(clean);
        if (age === null) setIdDocError('ID number format is invalid.');
        else if (age < 18) setIdDocError('You must be 18 or older.');
      }
    }
  };

  useEffect(() => {
    if (user?.id_document_number) setIdDocNumber(user.id_document_number);
    if (user?.id_document_type)   setIdDocType(user.id_document_type);
    if (user?.verified) {
      setVerifyIdStatus('verified');
      setVerifyIdMsg('Identity verified ✓');
    }
  }, [user]);

  const needsLicencePlan = selectedPlan === 'driver' || selectedPlan === 'both';

  // ── Handle Verify Identity (SA ID or Passport images) ───────────────────
  const handleVerifyId = async () => {
    // Validate inputs
    if (idDocType === 'sa_id') {
      if (!idDocNumber.trim()) { toast.error('Please enter your ID number'); return; }
      if (idDocNumber.replace(/\s/g, '').length !== 13) {
        toast.error('SA ID must be 13 digits'); return;
      }
      if (idDocError) { toast.error('Please fix the ID error'); return; }
    } else {
      if (!frontPassportFile || !backPassportFile) {
        toast.error('Please upload both front and back passport images'); return;
      }
    }

    setVerifyIdStatus('verifying');
    setVerifyIdMsg('');

    try {
      let requestBody = {};
      if (idDocType === 'sa_id') {
        requestBody = {
          idNumber: idDocNumber.trim().toUpperCase(),
          documentType: 'sa_id',
        };
      } else {
        // Convert images to base64 strings
        const toBase64 = file => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);  // data:image/jpeg;base64,...
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const frontBase64 = await toBase64(frontPassportFile);
        const backBase64  = await toBase64(backPassportFile);
        requestBody = {
          documentType: 'passport',
          frontImageBase64: frontBase64,
          backImageBase64: backBase64,
        };
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/verify-identity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (data.verified) {
        setVerifyIdStatus('verified');
        setVerifyIdMsg(data.message || 'Identity verified');
        toast.success('Verification successful! ✅ Badge earned.');
        setUser(await loadUser());
      } else {
        setVerifyIdStatus('failed');
        setVerifyIdMsg(data.message || 'Verification failed');
        toast.error(data.message || 'Verification failed');
      }
    } catch (err) {
      setVerifyIdStatus('failed');
      setVerifyIdMsg('Service unavailable. Try again later.');
      toast.error('Verification error');
    }
  };

  // Licence verification (unchanged, demo only)
  const handleVerifyLicencePlan = async () => { /* same as before */ };

  // ── Subscription handler (no verification gate) ─────────────────────────
  const handleSubscribe = async () => {
    if (isAdmin) { /* admin bypass unchanged */ return; }
    if (user?.date_of_birth) {
      // age check
    }
    if (idDocType === 'sa_id' && idDocNumber.trim().length === 13) {
      const age = ageFromSAId(idDocNumber.trim());
      if (age !== null && age < 18) {
        toast.error('You must be 18 or older'); return;
      }
    }
    if (idDocError) {
      toast.error('Please fix the ID document error.'); return;
    }
    // No verification status check!

    setProcessingPlan(true);
    try {
      const isFirstSubscription = !user?.subscription_active;
      const durationMs = isFirstSubscription ? 60 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const profileUpdate = {
        subscription_active: true,
        subscription_plan: selectedPlan,
        subscription_start: new Date().toISOString(),
        subscription_expires: new Date(Date.now() + durationMs).toISOString(),
      };
      if (needsLicencePlan && licencePlanStatus === 'verified') {
        profileUpdate.license_number = licencePlanNumber.trim().toUpperCase();
        profileUpdate.license_year = parseInt(licencePlanYear);
      }
      if (idDocNumber.trim()) {
        const cleanId = idDocNumber.trim().toUpperCase();
        const { data: bannedId } = await supabase
          .from('blacklisted_id_numbers')
          .select('id_number')
          .eq('id_number', cleanId)
          .maybeSingle();
        if (bannedId) {
          toast.error('Your ID/passport is flagged.', { duration: 8000 });
          setProcessingPlan(false);
          return;
        }
        profileUpdate.id_document_number = cleanId;
        profileUpdate.id_document_type = idDocType;
      }
      await auth.updateMe(profileUpdate);
      await supabase.auth.updateUser({ data: { subscription_plan: selectedPlan } });
      toast.success(isFirstSubscription
        ? 'Subscription activated! 35% off for 2 months.'
        : 'Plan updated!');
      setUser(await loadUser());
    } catch {
      toast.error('Failed to update subscription');
    } finally {
      setProcessingPlan(false);
    }
  };

  const handlePasswordChange = async () => { /* unchanged */ };
  const toggleDarkMode = () => { /* unchanged */ };
  const changeFontSize = (size) => { /* unchanged */ };
  const toggleNotifications = () => { /* unchanged */ };
  const toggleSignInMethod = async () => { /* unchanged */ };
  const handleLogout = async () => { /* unchanged */ };
  const handleVerifyIdentity = async () => { /* unchanged */ };
  const handleDeleteAccount = async () => { /* unchanged */ };

  // Admin functions unchanged...

  const isAdmin = user && ADMIN_EMAILS.includes(user.email);

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      {/* Back button & title */}
      {/* Tabs: General, Plan, Security, Admin (if applicable) */}
      {/* General tab content unchanged */}

      {/* Plan tab */}
      <TabsContent value="plan">
        <div className="space-y-4">
          {/* Active subscription badge / discount banner / plan cards unchanged */}

          {/* Driving licence (optional) – same as before, no verification block */}

          {/* Identity Document Card */}
          <Card className="p-4 border border-border/50 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
              <p className="font-semibold text-sm">Identity Document <span className="font-normal text-muted-foreground">(Optional — earns ✅ badge)</span></p>
            </div>
            <p className="text-xs text-muted-foreground">
              Verify your SA ID or passport to earn a verified badge on your profile. This is optional — you can subscribe without verifying.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Document Type</Label>
                <select
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={idDocType}
                  onChange={e => {
                    setIdDocType(e.target.value);
                    setIdDocNumber('');
                    setIdDocError('');
                    setFrontPassportFile(null);
                    setBackPassportFile(null);
                  }}
                >
                  <option value="sa_id">SA ID Number</option>
                  <option value="passport">Passport</option>
                </select>
              </div>

              {idDocType === 'sa_id' ? (
                <div>
                  <Label className="text-xs font-medium">SA ID Number</Label>
                  <Input
                    className={`mt-1 ${idDocError ? 'border-red-500' : ''}`}
                    placeholder="13-digit ID number"
                    value={idDocNumber}
                    maxLength={13}
                    onChange={e => handleIdDocChange(e.target.value.replace(/\s/g, ''))}
                  />
                </div>
              ) : (
                <div className="col-span-2 grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <Label className="text-xs font-medium">Front of Passport</Label>
                    <div className="mt-1 flex flex-col items-center gap-2">
                      {frontPassportFile ? (
                        <div className="text-xs text-emerald-600">✓ {frontPassportFile.name}</div>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full gap-1" onClick={() => frontInputRef.current?.click()}>
                          <Upload className="w-3 h-3" /> Choose File
                        </Button>
                      )}
                      <input
                        ref={frontInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => { if (e.target.files?.[0]) setFrontPassportFile(e.target.files[0]); }}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Back of Passport</Label>
                    <div className="mt-1 flex flex-col items-center gap-2">
                      {backPassportFile ? (
                        <div className="text-xs text-emerald-600">✓ {backPassportFile.name}</div>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full gap-1" onClick={() => backInputRef.current?.click()}>
                          <Upload className="w-3 h-3" /> Choose File
                        </Button>
                      )}
                      <input
                        ref={backInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => { if (e.target.files?.[0]) setBackPassportFile(e.target.files[0]); }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {idDocError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-xs">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>{idDocError}</span>
              </div>
            )}

            {/* Status messages */}
            {verifyIdStatus === 'verified' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm">
                <ShieldCheck className="w-4 h-4" />
                <span>{verifyIdMsg}</span>
              </div>
            )}
            {verifyIdStatus === 'failed' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                <XCircle className="w-4 h-4" />
                <span>{verifyIdMsg}</span>
              </div>
            )}

            {verifyIdStatus !== 'verified' && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleVerifyId}
                disabled={verifyIdStatus === 'verifying' || (idDocType === 'sa_id' ? (!idDocNumber.trim() || !!idDocError) : (!frontPassportFile || !backPassportFile))}
              >
                {verifyIdStatus === 'verifying'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                  : <><ShieldCheck className="w-4 h-4" /> Verify Identity</>}
              </Button>
            )}
            {verifyIdStatus === 'verified' && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setVerifyIdStatus('idle'); setVerifyIdMsg(''); }}>
                Use a different document
              </Button>
            )}
          </Card>

          {/* Subscribe Button */}
          <Button
            onClick={handleSubscribe}
            disabled={processingPlan || (!isAdmin && !!idDocError)}
            className="w-full gap-2"
          >
            {processingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {processingPlan ? 'Processing...' : user?.subscription_active ? 'Switch Plan' : 'Subscribe Now'}
          </Button>

          {/* Cancel subscription section unchanged */}
        </div>
      </TabsContent>

      {/* Security tab unchanged */}
      {/* Admin tab unchanged */}
    </div>
  );
}