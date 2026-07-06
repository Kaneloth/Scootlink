import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CheckCircle2, Crown, Bike, Users, Shield, Loader2, ArrowRight, ArrowLeft,
  AlertTriangle, FileText, XCircle, ShieldCheck, Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];

// ── Pricing ───────────────────────────────────────────────────────────────────
const PLANS = [
  {
    id: 'driver',
    name: 'Driver',
    icon: Bike,
    color: 'bg-blue-50 border-blue-200',
    badgeColor: 'bg-blue-100 text-blue-700',
    prices: { monthly: 39, '6month': 199, annual: 349 },
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
    icon: Crown,
    color: 'bg-amber-50 border-amber-200',
    badgeColor: 'bg-amber-100 text-amber-700',
    popular: true,
    prices: { monthly: 49, '6month': 249, annual: 449 },
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
    icon: Users,
    color: 'bg-primary/5 border-primary/30',
    badgeColor: 'bg-primary/10 text-primary',
    prices: { monthly: 59, '6month': 299, annual: 549 },
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

const BILLING_OPTIONS = [
  { id: 'monthly', label: 'Monthly',   saving: null,  days: 30  },
  { id: '6month',  label: '6 Months',  saving: '15%', days: 180 },
  { id: 'annual',  label: 'Annual',    saving: '25%', days: 365 },
];

export default function Subscription() {
  const navigate = useNavigate();
  const [user, setUser]         = useState(null);
  const [selected, setSelected] = useState('owner');
  const [billing, setBilling]   = useState('monthly');
  const [processing, setProcessing]       = useState(false);
  const [cancelling, setCancelling]       = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // ── Identity verification state ───────────────────────────────────────────
  const [citizenship, setCitizenship]       = useState('South African');
  const [saId, setSaId]                     = useState('');
  const [passport, setPassport]             = useState('');
  const [passportCountry, setPassportCountry] = useState('');
  const [idStatus, setIdStatus] = useState('idle'); // 'idle'|'verifying'|'verified'|'failed'
  const [idMsg, setIdMsg]       = useState('');

  // ── Licence verification state (driver / both only) ───────────────────────
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceYear, setLicenceYear]     = useState('');
  const [licenceStatus, setLicenceStatus] = useState('idle');
  const [licenceMsg, setLicenceMsg]       = useState('');

  const needsLicence = selected === 'driver' || selected === 'both';

  useEffect(() => {
    setLicenceStatus('idle');
    setLicenceMsg('');
  }, [selected]);

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      const plan = u.subscription_plan || u.account_type || 'driver';
      setSelected(plan === 'both' ? 'both' : plan);
      if (ADMIN_EMAILS.includes(u.email)) {
        setIdStatus('verified');
        setIdMsg('Admin account — verification exempt');
        setLicenceStatus('verified');
        setLicenceMsg('Admin account — verification exempt');
        return;
      }
      if (u.citizenship) setCitizenship(u.citizenship);
      if (u.sa_id)       setSaId(u.sa_id);
      if (u.passport)    setPassport(u.passport);
      if (u.verified && (u.sa_id || u.passport)) {
        setIdStatus('verified');
        setIdMsg('Identity already on record');
      }
      if (u.license_number) setLicenceNumber(u.license_number);
      if (u.license_year)   setLicenceYear(String(u.license_year));
      if (u.verified && u.license_number) {
        setLicenceStatus('verified');
        setLicenceMsg('Licence already on record');
      }
    }).catch(() => {});
  }, []);

  // ── Identity verification ─────────────────────────────────────────────────
  const handleVerifyIdentity = async () => {
    if (citizenship === 'South African') {
      if (!/^\d{13}$/.test(saId)) {
        toast.error('Please enter a valid 13-digit SA ID number');
        return;
      }
    } else {
      if (!passport.trim())        { toast.error('Please enter your passport number'); return; }
      if (!passportCountry.trim()) { toast.error('Please enter your country of issue'); return; }
    }
    setIdStatus('verifying');
    setIdMsg('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const res = await fetch('https://skootlink.co.za/.netlify/functions/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          idNumber: citizenship === 'South African' ? saId : passport.trim().toUpperCase(),
          documentType: citizenship === 'South African' ? 'sa_id' : 'passport',
        }),
      });
      const data = await res.json();
      if (data.verified) {
        setIdStatus('verified');
        setIdMsg(data.message || 'Identity verified successfully');
        toast.success('Identity verified! You can now subscribe.');
      } else {
        setIdStatus('failed');
        setIdMsg(data.message || 'Verification failed. Check your details and try again.');
        toast.error(data.message || 'Verification failed. Contact support if this continues.');
      }
    } catch (err) {
      setIdStatus('failed');
      setIdMsg('Verification service unavailable. Please try again later.');
      toast.error('Verification error: ' + (err.message || 'Unknown error'));
    }
  };

  // ── Licence verification ──────────────────────────────────────────────────
  const handleVerifyLicence = async () => {
    if (!licenceNumber.trim()) { toast.error('Please enter your licence number'); return; }
    if (!licenceYear.trim())   { toast.error('Please enter the year your licence was issued'); return; }
    const year = parseInt(licenceYear);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1960 || year > currentYear) {
      toast.error(`Issue year must be between 1960 and ${currentYear}`);
      return;
    }
    const licenceClean = licenceNumber.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(licenceClean)) {
      toast.error('Please enter a valid driving licence number (6–20 alphanumeric characters)');
      return;
    }
    setLicenceStatus('verifying');
    setLicenceMsg('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const res = await fetch('https://skootlink.co.za/.netlify/functions/verify-licence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ licenceNumber: licenceClean, yearIssued: year }),
      });
      const result = await res.json();
      if (result.verified) {
        setLicenceStatus('verified');
        setLicenceMsg('Driving licence verified successfully.');
        toast.success('Driving licence verified!');
      } else {
        setLicenceStatus('failed');
        setLicenceMsg(result.message || 'Could not verify your licence. Check the number and try again.');
        toast.error(result.message || 'Licence verification failed.');
      }
    } catch {
      setLicenceStatus('failed');
      setLicenceMsg('Verification service unavailable. Please try again.');
      toast.error('Licence verification failed. Please try again.');
    }
  };

  // ── Subscribe ─────────────────────────────────────────────────────────────
  const handleSubscribe = async () => {
    // Admin bypass
    if (ADMIN_EMAILS.includes(user?.email)) {
      setProcessing(true);
      try {
        await auth.updateMe({
          subscription_active:  true,
          subscription_plan:    selected,
          subscription_billing: billing,
          subscription_start:   new Date().toISOString(),
          subscription_expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          verified: true,
        });
        await supabase.auth.updateUser({ data: { subscription_plan: selected } });
        toast.success('Admin subscription activated!');
        window.location.href = '/';
      } catch {
        toast.error('Something went wrong. Please try again.');
        setProcessing(false);
      }
      return;
    }

    if (idStatus !== 'verified') {
      toast.error('Please verify your identity before subscribing');
      return;
    }
    if (needsLicence && licenceStatus !== 'verified') {
      toast.error('Please verify your driving licence before subscribing as a Driver');
      return;
    }

    setProcessing(true);
    try {
      const billingOption = BILLING_OPTIONS.find(b => b.id === billing);
      const durationMs    = billingOption.days * 24 * 60 * 60 * 1000;
      const isNew         = !user?.subscription_active;

      const profileUpdate = {
        subscription_active:  true,
        subscription_plan:    selected,
        subscription_billing: billing,
        subscription_start:   new Date().toISOString(),
        subscription_expires: new Date(Date.now() + durationMs).toISOString(),
        verified:    true,
        citizenship,
      };
      if (citizenship === 'South African') {
        profileUpdate.sa_id = saId;
      } else {
        profileUpdate.passport = passport;
      }
      if (needsLicence && licenceStatus === 'verified') {
        profileUpdate.license_number = licenceNumber.trim().toUpperCase();
        profileUpdate.license_year   = parseInt(licenceYear);
      }

      await auth.updateMe(profileUpdate);
      const { error } = await supabase.auth.updateUser({ data: { subscription_plan: selected } });
      if (error) {
        console.error('Failed to sync auth metadata', error);
        toast.warning('Plan updated, but you may need to re-login.');
      }
      toast.success(isNew ? 'Welcome to Skootlink! Enjoy your 30 days free.' : 'Plan updated! Welcome back to Skootlink.');
      window.location.href = '/';
    } catch {
      toast.error('Something went wrong. Please try again.');
      setProcessing(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    try {
      await auth.updateMe({
        subscription_active:  false,
        subscription_expires: new Date().toISOString(),
      });
      await supabase.auth.updateUser({ data: { subscription_active: false } });
      toast.success('Subscription cancelled. You can resubscribe any time.');
      const updated = await auth.me();
      setUser(updated);
      setShowCancelConfirm(false);
    } catch {
      toast.error('Failed to cancel subscription. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  const plan           = PLANS.find(p => p.id === selected);
  const billingOption  = BILLING_OPTIONS.find(b => b.id === billing);
  const planPrice      = plan?.prices[billing];
  const currentPlanName = PLANS.find(p => p.id === user?.subscription_plan)?.name;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">

        {/* Header bar */}
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="Skootlink" className="h-9 w-auto" />
          </Link>
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </div>

        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Crown className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Choose Your Plan</h1>
          <p className="text-sm text-muted-foreground mt-1">Subscribe to unlock full platform access</p>
        </div>

        {/* 30-day free trial banner — new subscribers only */}
        {!user?.subscription_active && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
            <Zap className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">30 days free — no payment today!</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                Verify your identity, pick a plan, and get 30 days of full access at no cost.
                Your selected billing cycle starts after the trial ends.
              </p>
            </div>
          </div>
        )}

        {/* Current plan badge */}
        {user?.subscription_active && currentPlanName && (
          <div className="mb-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 text-xs font-medium">
              ● Active: {currentPlanName} Plan
            </span>
          </div>
        )}

        {/* ── Billing period toggle ─────────────────────────────────────────── */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-border/50">
            {BILLING_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => setBilling(opt.id)}
                className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  billing === opt.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
                {opt.saving && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    billing === opt.id
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    -{opt.saving}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Upfront payment note for 6-month / annual */}
        {billing !== 'monthly' && (
          <p className="text-center text-xs text-muted-foreground mb-5">
            Paid once via card or EFT — no debit order, no recurring charge.
          </p>
        )}

        {/* ── Plan cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {PLANS.map(p => {
            const Icon      = p.icon;
            const isSelected = selected === p.id;
            const isCurrent  = user?.subscription_plan === p.id && user?.subscription_active;
            const price      = p.prices[billing];
            const monthlyCost = billing === 'monthly'
              ? price
              : billing === '6month'
                ? Math.round(price / 6)
                : Math.round(price / 12);

            return (
              <Card
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`p-5 cursor-pointer border-2 transition-all duration-200 relative ${
                  isSelected ? 'border-primary shadow-lg shadow-primary/10' : 'border-border hover:border-primary/40'
                }`}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-white text-[10px] px-3">Most Popular</Badge>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 right-4">
                    <Badge className="bg-green-600 text-white text-[10px] px-2">Current</Badge>
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <div className={`p-2 rounded-xl ${p.color} border`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                </div>
                <h3 className="font-bold text-foreground">{p.name}</h3>
                <div className="mt-1 mb-1">
                  <span className="text-2xl font-extrabold">R{price}</span>
                  <span className="text-xs text-muted-foreground">
                    {billing === 'monthly' ? '/month' : billing === '6month' ? '/6 months' : '/year'}
                  </span>
                </div>
                {billing !== 'monthly' && (
                  <p className="text-xs text-muted-foreground mb-3">≈ R{monthlyCost}/month</p>
                )}
                <ul className="space-y-1.5 mt-2">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>

        {/* ── Identity verification ─────────────────────────────────────────── */}
        <Card className="p-5 border border-border/50 mb-4 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
            <p className="font-semibold text-sm">Identity Verification</p>
            {idStatus === 'verified' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Your ID is verified once at subscription and stored securely. Required for all plans.
          </p>

          <div>
            <Label className="text-xs font-medium">Citizenship *</Label>
            <Select
              value={citizenship}
              onValueChange={v => {
                setCitizenship(v);
                setIdStatus('idle');
                setSaId('');
                setPassport('');
                setPassportCountry('');
              }}
              disabled={idStatus === 'verifying' || idStatus === 'verified'}
            >
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="South African">South African</SelectItem>
                <SelectItem value="Zimbabwean">Zimbabwean</SelectItem>
                <SelectItem value="Mozambican">Mozambican</SelectItem>
                <SelectItem value="Malawian">Malawian</SelectItem>
                <SelectItem value="Nigerian">Nigerian</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {citizenship === 'South African' ? (
            <div>
              <Label className="text-xs font-medium">SA ID Number (13 digits) *</Label>
              <Input
                className="mt-1 font-mono tracking-widest"
                placeholder="9001015009087"
                maxLength={13}
                value={saId}
                onChange={e => { setSaId(e.target.value.replace(/\D/g, '')); setIdStatus('idle'); }}
                disabled={idStatus === 'verifying' || idStatus === 'verified'}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Your ID number is encrypted and stored securely</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium">Passport Number *</Label>
                <Input
                  className="mt-1 font-mono"
                  placeholder="A12345678"
                  value={passport}
                  onChange={e => { setPassport(e.target.value.toUpperCase()); setIdStatus('idle'); }}
                  disabled={idStatus === 'verifying' || idStatus === 'verified'}
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Country of Issue *</Label>
                <Input
                  className="mt-1"
                  placeholder="Zimbabwe"
                  value={passportCountry}
                  onChange={e => { setPassportCountry(e.target.value); setIdStatus('idle'); }}
                  disabled={idStatus === 'verifying' || idStatus === 'verified'}
                />
              </div>
            </div>
          )}

          {idStatus === 'verified' && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{idMsg}</span>
            </div>
          )}
          {idStatus === 'failed' && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{idMsg}</span>
            </div>
          )}

          {idStatus !== 'verified' && (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleVerifyIdentity}
              disabled={
                idStatus === 'verifying' ||
                (citizenship === 'South African' ? saId.length !== 13 : !passport.trim())
              }
            >
              {idStatus === 'verifying'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                : <><ShieldCheck className="w-4 h-4" /> Verify Identity</>}
            </Button>
          )}
          {idStatus === 'verified' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { setIdStatus('idle'); setIdMsg(''); setSaId(''); setPassport(''); setPassportCountry(''); }}
            >
              Use different ID
            </Button>
          )}
        </Card>

        {/* ── Driving licence verification (driver / both only) ─────────────── */}
        {needsLicence && (
          <Card className="p-5 border border-border/50 mb-4 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <p className="font-semibold text-sm">Driving Licence Required</p>
              {licenceStatus === 'verified' && (
                <ShieldCheck className="w-4 h-4 text-emerald-500 ml-auto shrink-0" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A valid driving licence is required to drive vehicles on Skootlink.
              Your licence will be verified with the traffic department before activation.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium">Licence Number *</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. DL1234567"
                  value={licenceNumber}
                  onChange={e => { setLicenceNumber(e.target.value); setLicenceStatus('idle'); }}
                  disabled={licenceStatus === 'verifying' || licenceStatus === 'verified'}
                />
              </div>
              <div>
                <Label className="text-xs font-medium">Year Issued *</Label>
                <Input
                  className="mt-1"
                  type="number"
                  placeholder="e.g. 2018"
                  value={licenceYear}
                  onChange={e => { setLicenceYear(e.target.value); setLicenceStatus('idle'); }}
                  disabled={licenceStatus === 'verifying' || licenceStatus === 'verified'}
                />
              </div>
            </div>

            {licenceStatus === 'verified' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{licenceMsg}</span>
              </div>
            )}
            {licenceStatus === 'failed' && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>{licenceMsg}</span>
              </div>
            )}

            {licenceStatus !== 'verified' && (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleVerifyLicence}
                disabled={licenceStatus === 'verifying' || !licenceNumber.trim() || !licenceYear.trim()}
              >
                {licenceStatus === 'verifying'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
                  : <><ShieldCheck className="w-4 h-4" /> Verify Licence</>}
              </Button>
            )}
            {licenceStatus === 'verified' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => { setLicenceStatus('idle'); setLicenceMsg(''); }}
              >
                Use a different licence
              </Button>
            )}
          </Card>
        )}

        {/* ── Summary + subscribe ───────────────────────────────────────────── */}
        <Card className="p-5 border border-border/50 mb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Selected Plan</p>
              <p className="font-bold text-lg">
                {plan?.name} — R{planPrice}
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  {billing === 'monthly' ? '/month' : billing === '6month' ? '/6 months' : '/year'}
                </span>
              </p>
              {!user?.subscription_active && (
                <p className="text-xs text-emerald-600 mt-0.5 font-medium">
                  30 days free · billing starts day 31
                </p>
              )}
              {idStatus !== 'verified' && (
                <p className="text-xs text-amber-600 mt-0.5">Identity verification required to continue</p>
              )}
              {idStatus === 'verified' && needsLicence && licenceStatus !== 'verified' && (
                <p className="text-xs text-amber-600 mt-0.5">Licence verification required to continue</p>
              )}
            </div>
            <Button
              onClick={handleSubscribe}
              disabled={processing || (!ADMIN_EMAILS.includes(user?.email) && (idStatus !== 'verified' || (needsLicence && licenceStatus !== 'verified')))}
              className="gap-2 px-6 shrink-0"
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {processing ? 'Processing...' : user?.subscription_active ? 'Switch Plan' : 'Start Free Trial'}
            </Button>
          </div>
        </Card>

        {/* Skip */}
        {!user?.subscription_active && (
          <div className="text-center mb-4">
            <button
              onClick={() => navigate('/')}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Skip for now — I'll subscribe later
            </button>
          </div>
        )}

        {/* Cancel subscription */}
        {user?.subscription_active && !showCancelConfirm && (
          <div className="text-center mb-4">
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="text-sm text-destructive/70 hover:text-destructive underline underline-offset-2 transition-colors"
            >
              Cancel my subscription
            </button>
          </div>
        )}

        {user?.subscription_active && showCancelConfirm && (
          <Card className="p-5 border border-destructive/30 bg-destructive/5 mb-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm text-destructive/80 space-y-1">
                <p className="font-semibold">Cancel your subscription?</p>
                <p className="text-xs">You'll lose access to all paid features at the end of your current billing period. Your profile and data will be kept.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowCancelConfirm(false)} disabled={cancelling}>
                Keep My Plan
              </Button>
              <Button variant="destructive" className="flex-1 gap-2" onClick={handleCancelSubscription} disabled={cancelling}>
                {cancelling ? <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling…</> : 'Yes, Cancel'}
              </Button>
            </div>
          </Card>
        )}

        <div className="flex items-center gap-2 justify-center text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5" />
          Payments are encrypted and secure. Cancel anytime.
        </div>
      </div>
    </div>
  );
}
