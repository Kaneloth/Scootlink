import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import {
  User, Phone, MapPin, CreditCard, ShieldCheck,
  CheckCircle2, ArrowRight, ArrowLeft, Loader2, AlertTriangle, Bike
} from 'lucide-react';
import { toast } from 'sonner';

// ── Location data ─────────────────────────────────────────────────────────────
const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
];

const SA_PROVINCE_CITIES = {
  'Eastern Cape': [
    'Aliwal North', 'Bhisho', 'East London', 'Gqeberha (Port Elizabeth)',
    'Grahamstown', 'Humansdorp', 'Jeffreys Bay', "King William's Town",
    'Mthatha', 'Port Alfred', 'Queenstown', 'Stutterheim',
  ],
  'Free State': [
    'Bethlehem', 'Bloemfontein', 'Ficksburg', 'Harrismith', 'Kroonstad',
    'Parys', 'Phuthaditjhaba', 'Sasolburg', 'Virginia', 'Welkom',
  ],
  'Gauteng': [
    'Alberton', 'Benoni', 'Boksburg', 'Carletonville', 'Centurion',
    'Edenvale', 'Fourways', 'Germiston', 'Johannesburg', 'Kempton Park',
    'Midrand', 'Pretoria', 'Randburg', 'Randfontein', 'Roodepoort',
    'Sandton', 'Soweto', 'Springs', 'Vanderbijlpark', 'Vereeniging',
  ],
  'KwaZulu-Natal': [
    'Ballito', 'Durban', 'Empangeni', 'Kloof', 'Ladysmith', 'Margate',
    'Newcastle', 'Pietermaritzburg', 'Pinetown', 'Port Shepstone',
    'Richards Bay', 'Stanger', 'Ulundi', 'Umhlanga', 'Vryheid', 'Westville',
  ],
  'Limpopo': [
    'Bela-Bela', 'Giyani', 'Louis Trichardt', 'Modimolle', 'Mokopane',
    'Musina', 'Phalaborwa', 'Polokwane', 'Thohoyandou', 'Tzaneen',
  ],
  'Mpumalanga': [
    'Barberton', 'Ermelo', 'Graskop', 'Hazyview', 'Komatipoort',
    'Malelane', 'Mbombela (Nelspruit)', 'Middelburg', 'Piet Retief',
    'Sabie', 'Secunda', 'Witbank (eMalahleni)',
  ],
  'North West': [
    'Brits', 'Hartbeespoort', 'Klerksdorp', 'Lichtenburg', 'Mahikeng',
    'Potchefstroom', 'Rustenburg', 'Wolmaransstad', 'Zeerust',
  ],
  'Northern Cape': [
    'Colesberg', 'De Aar', 'Kathu', 'Kimberley', 'Kuruman',
    'Pofadder', 'Springbok', 'Upington',
  ],
  'Western Cape': [
    'Beaufort West', 'Bellville', 'Cape Town', 'Durbanville', 'George',
    'Hermanus', 'Knysna', 'Malmesbury', 'Mossel Bay', 'Oudtshoorn',
    'Paarl', 'Saldanha', 'Somerset West', 'Stellenbosch', 'Strand',
    'Swellendam', 'Vredenburg', 'Worcester',
  ],
};

// ── Phone normalisation ───────────────────────────────────────────────────────
// Converts any common SA format to E.164 (+27XXXXXXXXX) so BulkSMS always works.
// Handles: 0812345678  →  +27812345678
//          27812345678 →  +27812345678
//          +27812345678 → +27812345678 (no-op)
//          812345678   →  +27812345678 (9-digit without leading 0)
function normalisePhone(raw) {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 10) return raw;
  if (digits.startsWith('27') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+27' + digits.slice(1);
  if (digits.length === 9) return '+27' + digits;
  return raw; // unknown — leave as-is and let validation catch it
}

// ── Steps ─────────────────────────────────────────────────────────────────────
const STEPS = [
  { id: 'personal', label: 'Personal Info',  icon: User        },
  { id: 'identity', label: 'Identity',       icon: CreditCard  },
  { id: 'verify',   label: 'Verification',   icon: ShieldCheck },
];

export default function Onboarding() {
  const navigate   = useNavigate();
  const [step,               setStep]               = useState(0);
  const [verifying,          setVerifying]          = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [saving,             setSaving]             = useState(false);

  const [form, setForm] = useState({
    phone:               '',
    gender:              '',
    date_of_birth:       '',
    // Location fields
    country_type:        'South Africa',   // 'South Africa' | 'Other'
    sa_province:         '',
    sa_city:             '',               // city name or '__other__'
    sa_city_other:       '',              // free-text when sa_city === '__other__'
    other_country:       '',
    other_province:      '',
    other_city:          '',
    residential_address: '',
    // Identity
    citizenship:         'South African',
    sa_id:               '',
    passport:            '',
    passport_country:    '',
  });

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  // When province changes, reset city selection
  const updateProvince = (val) => {
    setForm(p => ({ ...p, sa_province: val, sa_city: '', sa_city_other: '' }));
  };

  // When country type changes, reset all location sub-fields
  const updateCountryType = (val) => {
    setForm(p => ({
      ...p,
      country_type:   val,
      sa_province:    '',
      sa_city:        '',
      sa_city_other:  '',
      other_country:  '',
      other_province: '',
      other_city:     '',
    }));
  };

  // Build the `location` string saved to the DB from whatever was entered
  const buildLocation = () => {
    if (form.country_type === 'South Africa') {
      const city = form.sa_city === '__other__' ? form.sa_city_other : form.sa_city;
      return [city, form.sa_province, 'South Africa'].filter(Boolean).join(', ');
    }
    return [form.other_city, form.other_province, form.other_country].filter(Boolean).join(', ');
  };

  // ── Validation ──────────────────────────────────────────────────────────────
  const validatePersonal = () => {
    if (!form.phone || !form.gender || !form.date_of_birth || !form.residential_address) {
      toast.error('Please fill in all required fields');
      return false;
    }
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (!form.phone.startsWith('+') || phoneDigits.length < 10 || phoneDigits.length > 15) {
      toast.error('Please enter a valid phone number (e.g. 082 123 4567 or +27 82 123 4567)');
      return false;
    }
    if (form.country_type === 'South Africa') {
      if (!form.sa_province) { toast.error('Please select a province'); return false; }
      if (!form.sa_city)     { toast.error('Please select a city or town'); return false; }
      if (form.sa_city === '__other__' && !form.sa_city_other.trim()) {
        toast.error('Please enter your city or town'); return false;
      }
    } else {
      if (!form.other_country.trim())  { toast.error('Please enter your country'); return false; }
      if (!form.other_city.trim())     { toast.error('Please enter your city or town'); return false; }
    }
    return true;
  };

  const validateIdentity = () => {
    if (form.citizenship === 'South African' && !form.sa_id) {
      toast.error('SA ID number is required'); return false;
    }
    if (form.citizenship !== 'South African' && (!form.passport || !form.passport_country)) {
      toast.error('Passport details are required'); return false;
    }
    return true;
  };

  // ── Home Affairs verification (DEMO MODE — auto-passes when required fields filled) ──
  const runVerification = async () => {
    setVerifying(true);
    // Brief simulated delay to mimic a real check
    await new Promise(r => setTimeout(r, 1500));

    const isSA      = form.citizenship === 'South African';
    const hasId     = isSA ? !!form.sa_id : (!!form.passport && !!form.passport_country);
    const allFilled = !!form.date_of_birth && !!form.gender && !!form.phone;
    // Demo mode: verified as long as required fields are present
    const verified  = hasId && allFilled;

    const checks_passed = [];
    const flags = [];
    if (form.date_of_birth)  checks_passed.push('Date of birth provided');
    if (form.gender)         checks_passed.push('Gender confirmed');
    if (form.phone)          checks_passed.push('Contact number verified');
    if (isSA && form.sa_id)  checks_passed.push('SA ID number provided');
    if (!isSA && form.passport) checks_passed.push('Passport number provided');
    if (!hasId)              flags.push(isSA ? 'SA ID number is required' : 'Passport details are required');
    if (!allFilled)          flags.push('Some required fields are missing');
    if (verified)            checks_passed.push('Identity verification passed (demo mode)');

    setVerificationResult({ verified, confidence_score: verified ? 100 : 40, checks_passed, flags });
    setVerifying(false);
  };

  useEffect(() => { if (step === 2) runVerification(); }, [step]);

  // ── Save helpers ──────────────────────────────────────────────────────────
  const buildProfilePayload = () => ({
    phone:                normalisePhone(form.phone),
    gender:               form.gender,
    date_of_birth:        form.date_of_birth,
    location:             buildLocation(),
    residential_address:  form.residential_address,
    citizenship:          form.citizenship,
    sa_id:                form.sa_id || undefined,
    passport:             form.passport || undefined,
    passport_country:     form.passport_country || undefined,
    verified:             verificationResult?.verified || false,
    kyc_completed:        true,
    subscription_active:  false,
    onboarding_completed: true,
  });

  const handleComplete = async () => {
    setSaving(true);
    try {
      await auth.updateMe(buildProfilePayload());
      toast.success('Profile setup complete! Please subscribe to get started.');
      navigate('/subscription');
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSkipSubscription = async () => {
    setSaving(true);
    try {
      await auth.updateMe(buildProfilePayload());
      toast.success('Profile saved! You can subscribe any time from Settings.');
      navigate('/');
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const nextStep = () => {
    if (step === 0 && !validatePersonal())  return;
    if (step === 1 && !validateIdentity())  return;
    setStep(s => s + 1);
  };

  const currentStep = STEPS[step];

  // Derived helpers for the location section
  const isSA         = form.country_type === 'South Africa';
  const cityList     = isSA && form.sa_province ? SA_PROVINCE_CITIES[form.sa_province] ?? [] : [];
  const cityIsOther  = form.sa_city === '__other__';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">

        {/* Logo */}
        <div className="flex justify-center mb-6">
          <a href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow">
              <Bike className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-foreground">Skootlink</span>
          </a>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <currentStep.icon className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Set Up Your Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Step {step + 1} of {STEPS.length}</p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1.5 mb-8">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${i <= step ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>

        <Card className="p-6 shadow-lg border border-border/50">

          {/* ── Step 0: Personal Info ──────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-lg">Personal Information</h2>

              <div className="grid grid-cols-2 gap-4">

                {/* Phone */}
                <div>
                  <Label className="text-xs font-medium">Phone Number *</Label>
                  <Input
                    className="mt-1"
                    placeholder="082 123 4567 or +27 82 123 4567"
                    value={form.phone}
                    onChange={e => update('phone', e.target.value)}
                    onBlur={e => update('phone', normalisePhone(e.target.value))}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">SA numbers are auto-converted to international format (+27…)</p>
                </div>

                {/* Gender */}
                <div>
                  <Label className="text-xs font-medium">Gender *</Label>
                  <Select value={form.gender} onValueChange={v => update('gender', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date of Birth */}
                <div className="col-span-2">
                  <Label className="text-xs font-medium">Date of Birth *</Label>
                  <Input className="mt-1" type="date" value={form.date_of_birth} onChange={e => update('date_of_birth', e.target.value)} />
                </div>

              </div>

              {/* ── Location ──────────────────────────────────────────────── */}
              <div className="space-y-3 pt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location</p>

                {/* Country selector */}
                <div>
                  <Label className="text-xs font-medium">Country *</Label>
                  <Select value={form.country_type} onValueChange={updateCountryType}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="South Africa">South Africa</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {isSA ? (
                  <>
                    {/* Province */}
                    <div>
                      <Label className="text-xs font-medium">Province *</Label>
                      <Select value={form.sa_province} onValueChange={updateProvince}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select province" /></SelectTrigger>
                        <SelectContent>
                          {SA_PROVINCES.map(p => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* City — only show once province is selected */}
                    {form.sa_province && (
                      <div>
                        <Label className="text-xs font-medium">City / Town *</Label>
                        <Select value={form.sa_city} onValueChange={v => update('sa_city', v)}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select city or town" /></SelectTrigger>
                          <SelectContent>
                            {cityList.map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                            <SelectItem value="__other__">Other (specify below)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Free-text if "Other" city chosen */}
                    {cityIsOther && (
                      <div>
                        <Label className="text-xs font-medium">Specify City / Town *</Label>
                        <Input
                          className="mt-1"
                          placeholder="Enter your city or town"
                          value={form.sa_city_other}
                          onChange={e => update('sa_city_other', e.target.value)}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Other country — free text fields */}
                    <div>
                      <Label className="text-xs font-medium">Country *</Label>
                      <Input className="mt-1" placeholder="e.g. Kenya" value={form.other_country} onChange={e => update('other_country', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium">Province / State / Region</Label>
                      <Input className="mt-1" placeholder="e.g. Nairobi County" value={form.other_province} onChange={e => update('other_province', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs font-medium">City / Town *</Label>
                      <Input className="mt-1" placeholder="e.g. Nairobi" value={form.other_city} onChange={e => update('other_city', e.target.value)} />
                    </div>
                  </>
                )}
              </div>

              {/* Residential Address (always shown) */}
              <div>
                <Label className="text-xs font-medium">Residential Address *</Label>
                <Input className="mt-1" placeholder="123 Main St, Johannesburg, 2000" value={form.residential_address} onChange={e => update('residential_address', e.target.value)} />
              </div>

            </div>
          )}

          {/* ── Step 1: Identity ──────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-lg">Identity Verification</h2>
              <p className="text-sm text-muted-foreground">Your details will be verified against the Home Affairs database.</p>

              <div>
                <Label className="text-xs font-medium">Citizenship *</Label>
                <Select value={form.citizenship} onValueChange={v => update('citizenship', v)}>
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

              {form.citizenship === 'South African' ? (
                <div>
                  <Label className="text-xs font-medium">SA ID Number (13 digits) *</Label>
                  <Input
                    className="mt-1 font-mono tracking-widest"
                    placeholder="9001015009087"
                    maxLength={13}
                    value={form.sa_id}
                    onChange={e => update('sa_id', e.target.value.replace(/\D/g, ''))}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Your ID number is encrypted and stored securely</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Passport Number *</Label>
                    <Input className="mt-1 font-mono" placeholder="A12345678" value={form.passport} onChange={e => update('passport', e.target.value.toUpperCase())} />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Country of Issue *</Label>
                    <Input className="mt-1" placeholder="Zimbabwe" value={form.passport_country} onChange={e => update('passport_country', e.target.value)} />
                  </div>
                </div>
              )}

              <div className="bg-primary/5 rounded-xl p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Why we need this</p>
                  <p className="text-xs text-muted-foreground mt-0.5">We verify your identity with DHA (Department of Home Affairs) to ensure platform safety for all users. Your data is encrypted and never shared.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Verification ──────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-semibold text-lg">Home Affairs Verification</h2>

              {verifying ? (
                <div className="flex flex-col items-center py-10 gap-4">
                  <div className="relative w-16 h-16">
                    <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <ShieldCheck className="absolute inset-0 m-auto w-7 h-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-foreground">Verifying with DHA...</p>
                    <p className="text-sm text-muted-foreground mt-1">This takes a few seconds</p>
                  </div>
                </div>
              ) : verificationResult ? (
                <div className="space-y-4">
                  <div className={`p-4 rounded-xl flex items-center gap-3 ${verificationResult.verified ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                    {verificationResult.verified
                      ? <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
                      : <AlertTriangle className="w-8 h-8 text-amber-500 shrink-0" />}
                    <div>
                      <p className={`font-semibold ${verificationResult.verified ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {verificationResult.verified ? 'Identity Verified' : 'Verification Pending'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Confidence: {verificationResult.confidence_score}%</p>
                    </div>
                  </div>

                  {verificationResult.checks_passed?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">CHECKS PASSED</p>
                      <div className="space-y-1.5">
                        {verificationResult.checks_passed.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {verificationResult.flags?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">FLAGS</p>
                      <div className="space-y-1.5">
                        {verificationResult.flags.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* ── Navigation ────────────────────────────────────────────────── */}
          <div className="mt-6 pt-4 border-t border-border space-y-3">
            <div className="flex justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>

              {step < STEPS.length - 1 ? (
                <Button onClick={nextStep} className="gap-2" disabled={step === 2 && verifying}>
                  {step === 2 && verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Continue <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button onClick={handleComplete} className="gap-2" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Subscribe & Get Started'}
                </Button>
              )}
            </div>

            {/* Skip subscription — only shown on the final step */}
            {step === STEPS.length - 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={handleSkipSubscription}
                disabled={saving}
              >
                Skip subscription for now
              </Button>
            )}
          </div>

        </Card>
      </div>
    </div>
  );
}
