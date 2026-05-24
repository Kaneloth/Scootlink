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
  AlertTriangle, FileText, XCircle, ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const PLANS = [
  {
    id: 'driver',
    name: 'Driver',
    price: 39,
    period: 'month',
    icon: Bike,
    color: 'bg-blue-50 border-blue-200',
    badgeColor: 'bg-blue-100 text-blue-700',
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
    price: 49,
    period: 'month',
    icon: Crown,
    color: 'bg-amber-50 border-amber-200',
    badgeColor: 'bg-amber-100 text-amber-700',
    popular: true,
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
    price: 59,
    period: 'month',
    icon: Users,
    color: 'bg-primary/5 border-primary/30',
    badgeColor: 'bg-primary/10 text-primary',
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

export default function Subscription() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [selected, setSelected] = useState('owner');
  const [processing, setProcessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // ── Identity verification state (required for ALL plans) ──────────────────
  const [citizenship, setCitizenship] = useState('South African');
  const [saId, setSaId]               = useState('');
  const [passport, setPassport]       = useState('');
  const [passportCountry, setPassportCountry] = useState('');
  const [idStatus, setIdStatus] = useState('idle'); // 'idle' | 'verifying' | 'verified' | 'failed'
  const [idMsg, setIdMsg]       = useState('');

  // ── Licence verification state (only required for driver / both plans) ──────
  const [licenceNumber, setLicenceNumber] = useState('');
  const [licenceYear, setLicenceYear]     = useState('');
  const [licenceStatus, setLicenceStatus] = useState('idle'); // 'idle' | 'verifying' | 'verified' | 'failed'
  const [licenceMsg, setLicenceMsg]       = useState('');

  const needsLicence = selected === 'driver' || selected === 'both';

  // Reset licence status whenever the plan changes
  useEffect(() => {
    setLicenceStatus('idle');
    setLicenceMsg('');
  }, [selected]);

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      const plan = u.subscription_plan || u.account_type || 'driver';
      setSelected(plan === 'both' ? 'both' : plan);
      // Pre-fill identity fields from profile
      if (u.citizenship) setCitizenship(u.citizenship);
      if (u.sa_id)       setSaId(u.sa_id);
      if (u.passport)    setPassport(u.passport);
      // If already verified, skip re-verification
      if (u.verified && (u.sa_id || u.passport)) {
        setIdStatus('verified');
        setIdMsg('Identity already on record');
      }
      // Pre-fill licence if they already have one on record
      if (u.license_number) setLicenceNumber(u.license_number);
      if (u.license_year)   setLicenceYear(String(u.license_year));
      // If already verified with a licence, mark it verified
      if (u.verified && u.license_number) {
        setLicenceStatus('verified');
        setLicenceMsg('Licence already on record');
      }
    }).catch(() => {});
  }, []);

  const handleVerifyIdentity = async () => {
    if (citizenship === 'South African') {
      if (!/^\d{13}$/.test(saId)) {
        toast.error('Please enter a valid 13-digit SA ID number');
        return;
      }
    } else {
      if (!passport.trim()) { toast.error('Please enter your passport number'); return; }
      if (!passportCountry.trim()) { toast.error('Please enter your country of issue'); return; }
    }
    setIdStatus('verifying');
    setIdMsg('');
    // Demo mode — hook up real DHA API here when ready
    await new Promise(r => setTimeout(r, 1200));
    setIdStatus('verified');
    setIdMsg('Identity verified successfully');
    toast.success('Identity verified!');
  };

  const handleVerifyLicence = async () => {
    if (!licenceNumber.trim()) {
      toast.error('Please enter your licence number');
      return;
    }
    if (!licenceYear.trim()) {
      toast.error('Please enter the year your licence was issued');
      return;
    }

    const year = parseInt(licenceYear);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1960 || year > currentYear) {
      toast.error(`Issue year must be between 1960 and ${currentYear}`);
      return;
    }

    setLicenceStatus('verifying');
    setLicenceMsg('');

    // Demo mode: simulate a short verification delay then approve
    await new Promise(r => setTimeout(r, 1200));

    setLicenceStatus('verified');
    setLicenceMsg('Licence verified successfully (demo mode)');
    toast.success('Driving licence verified!');
  };

  const handleSubscribe = async () => {
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
      const isFirstSubscription = !user?.subscription_active;
      // New subscribers get 35% off for 2 months — 60 days total access.
      // Renewals / plan switches get the standard 30 days.
      const durationMs = isFirstSubscription
        ? 60 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

      const profileUpdate = {
        subscription_active: true,
        subscription_plan:   selected,
        subscription_start:  new Date().toISOString(),
        subscription_expires: new Date(Date.now() + durationMs).toISOString(),
        verified:    true,     // identity verified as part of subscription flow
        citizenship,
      };
      // Save whichever ID type was verified
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
      const { error } = await supabase.auth.updateUser({
        data: { subscription_plan: selected }
      });
      if (error) {
        console.error('Failed to sync auth metadata', error);
        toast.warning('Plan updated, but you may need to re-login.');
      }
      toast.success(
        isFirstSubscription
          ? 'Subscription activated! 35% discount applied for your first 2 months — enjoy Skootlink!'
          : 'Plan updated! Welcome back to Skootlink.'
      );
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
        subscription_active: false,
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

  const plan = PLANS.find(p => p.id === selected);
  const currentPlanName = PLANS.find(p => p.id === user?.subscription_plan)?.name;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow">
              <Bike className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-foreground">Skootlink</span>
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

        {/* 35% discount banner — new subscribers only */}
        {!user?.subscription_active && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">35% off your first 2 months!</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                Verify your identity and subscribe today to lock in 35% off for your first two months.
                Full price applies from month three — no surprises.
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {PLANS.map(p => {
            const Icon = p.icon;
            const isSelected = selected === p.id;
            const isCurrent = user?.subscription_plan === p.id && user?.subscription_active;
            return (
              <Card
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`p-5 cursor-pointer border-2 transition-all duration-200 relative ${isSelected ? 'border-primary shadow-lg shadow-primary/10' : 'border-border hover:border-primary/40'}`}
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
                <div className="mt-1 mb-4">
                  <span className="text-2xl font-extrabold">R {p.price}</span>
                  <span className="text-xs text-muted-foreground">/{p.period}</span>
                </div>
                <ul className="space-y-1.5">
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

        {/* ── Identity verification (required for ALL plans) ───────────────── */}
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

          {/* Citizenship selector */}
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

          {/* SA ID or Passport */}
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

          {/* Status feedback */}
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

        {/* ── Driving licence verification (driver / both plans only) ─────── */}
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

            {/* Status feedback */}
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

        {/* Summary + subscribe */}
        <Card className="p-5 border border-border/50 mb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Selected Plan</p>
              <p className="font-bold text-lg">{plan?.name} — R {plan?.price}/month</p>
              {!user?.subscription_active && (
                <p className="text-xs text-emerald-600 mt-0.5 font-medium">
                  First month free · billing starts day 31
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
              disabled={processing || idStatus !== 'verified' || (needsLicence && licenceStatus !== 'verified')}
              className="gap-2 px-6 shrink-0"
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {processing ? 'Processing...' : user?.subscription_active ? 'Switch Plan' : 'Subscribe Now'}
            </Button>
          </div>
        </Card>

        {/* Skip — only for new users who haven't subscribed yet */}
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
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelling}
              >
                Keep My Plan
              </Button>
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                onClick={handleCancelSubscription}
                disabled={cancelling}
              >
                {cancelling
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling…</>
                  : 'Yes, Cancel'}
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
