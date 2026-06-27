import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { geocodeLocation } from '@/lib/geocode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import {
  User, Users, Crown, CheckCircle2, ArrowRight, ArrowLeft, Loader2, Bike, Info,
} from 'lucide-react';
import { toast } from 'sonner';

const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];

// ── Location data ─────────────────────────────────────────────────────────────
const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
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

// ── Customer code generator ───────────────────────────────────────────────────
// Generates a unique customer reference e.g. "SKT-12345ABC"
// Format: SKT- + 5 digits + 3 uppercase letters
function generateCustomerCode() {
  const digits  = '0123456789';
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = 'SKT-';
  for (let i = 0; i < 5; i++) code += digits[Math.floor(Math.random() * 10)];
  for (let i = 0; i < 3; i++) code += letters[Math.floor(Math.random() * 26)];
  return code;
}

// ── Phone normalisation ───────────────────────────────────────────────────────
function normalisePhone(raw) {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 10) return raw;
  if (digits.startsWith('27') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+27' + digits.slice(1);
  if (digits.length === 9) return '+27' + digits;
  return raw;
}

// ── Steps ─────────────────────────────────────────────────────────────────────
const STEPS = [
  { id: 'role',     label: 'Your Role',    icon: Users },
  { id: 'personal', label: 'Personal Info', icon: User  },
];

// ── Role options ──────────────────────────────────────────────────────────────
const ROLES = [
  {
    id: 'driver',
    name: 'Driver',
    description: 'Search for and rent vehicles listed by owners on Skootlink.',
    freeCredits: 18,
    icon: Bike,
    bg:   'bg-blue-50',
    border: 'border-blue-200',
    iconColor: 'text-blue-600',
  },
  {
    id: 'owner',
    name: 'Owner',
    description: 'List your vehicles and connect with verified drivers.',
    freeCredits: 36,
    icon: Crown,
    bg:   'bg-amber-50',
    border: 'border-amber-200',
    iconColor: 'text-amber-600',
  },
  {
    id: 'both',
    name: 'Driver & Owner',
    description: 'Drive other vehicles and list your own — full platform access.',
    freeCredits: 36,
    icon: Users,
    bg:   'bg-primary/5',
    border: 'border-primary/30',
    iconColor: 'text-primary',
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep]   = useState(0);
  const [saving, setSaving] = useState(false);
  const [currentEmail, setCurrentEmail] = useState('');

  useEffect(() => {
    auth.me().then(u => { if (u?.email) setCurrentEmail(u.email); }).catch(() => {});
  }, []);

  const [form, setForm] = useState({
    role:                'driver',
    phone:               '',
    gender:              '',
    date_of_birth:       '',
    country_type:        'South Africa',
    sa_province:         '',
    sa_city:             '',
    sa_city_other:       '',
    other_country:       '',
    other_province:      '',
    other_city:          '',
    residential_address: '',
  });

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  const updateProvince = (val) => {
    setForm(p => ({ ...p, sa_province: val, sa_city: '', sa_city_other: '' }));
  };

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

  const buildLocation = () => {
    if (form.country_type === 'South Africa') {
      const city = form.sa_city === '__other__' ? form.sa_city_other : form.sa_city;
      return [city, form.sa_province, 'South Africa'].filter(Boolean).join(', ');
    }
    return [form.other_city, form.other_province, form.other_country].filter(Boolean).join(', ');
  };

  const validatePersonal = () => {
    if (!form.phone || !form.gender || !form.date_of_birth || !form.residential_address) {
      toast.error('Please fill in all required fields');
      return false;
    }
    // 18+ age gate — skipped for admin accounts
    const isAdminAccount = ADMIN_EMAILS.includes(currentEmail);
    if (!isAdminAccount) {
      const dob = new Date(form.date_of_birth);
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      if (age < 18) {
        toast.error('You must be 18 or older to register on Skootlink');
        return false;
      }
    }
    const digits = form.phone.replace(/\D/g, '');
    if (!form.phone.startsWith('+') || digits.length < 10 || digits.length > 15) {
      toast.error('Please enter a valid phone number');
      return false;
    }
    if (form.country_type === 'South Africa') {
      if (!form.sa_province) { toast.error('Please select a province'); return false; }
      if (!form.sa_city)     { toast.error('Please select a city or town'); return false; }
      if (form.sa_city === '__other__' && !form.sa_city_other.trim()) {
        toast.error('Please specify your city or town'); return false;
      }
    } else {
      if (!form.other_country.trim()) { toast.error('Please enter your country'); return false; }
      if (!form.other_city.trim())    { toast.error('Please enter your city or town'); return false; }
    }
    return true;
  };

  const buildProfilePayload = () => ({
    account_type:         form.role,
    phone:                normalisePhone(form.phone),
    gender:               form.gender,
    date_of_birth:        form.date_of_birth,
    location:             buildLocation(),
    residential_address:  form.residential_address,
    onboarding_completed: true,
    customer_code:        generateCustomerCode(),
  });

  const saveGeoLocation = async (locationText, userId) => {
    if (!locationText || !userId) return;
    try {
      const coords = await geocodeLocation(locationText);
      if (coords) {
        const { error } = await supabase.rpc('set_user_geo_location', {
          p_user_id: userId,
          p_lng:     coords.longitude,
          p_lat:     coords.latitude,
        });
        if (error) console.error('[Onboarding] set_user_geo_location error:', error);
      }
    } catch (err) { console.error('[Onboarding] geocode error:', err); }
  };

  const saveAndNavigate = async (destination) => {
    setSaving(true);
    try {
      await auth.updateMe(buildProfilePayload());
      const { data: { user: authUser } } = await supabase.auth.getUser();
      // Write residential_address directly to profiles — auth.updateMe() does not sync it
      if (authUser?.id && form.residential_address) {
        await supabase.from('profiles').update({
          residential_address: form.residential_address,
        }).eq('id', authUser.id);
      }
      await saveGeoLocation(buildLocation(), authUser?.id);

      // ── Award sign-up free credits based on role ──────────────────────────
      // Driver → 18 credits, Owner or Both → 36 credits
      if (authUser?.id) {
        const freeCredits = form.role === 'driver' ? 18 : 36;
        try {
          await supabase.rpc('add_credits', {
            p_user_id:     authUser.id,
            p_amount:      freeCredits,
            p_type:        'bonus',
            p_description: 'Welcome bonus credits',
          });
        } catch (creditErr) {
          // Non-fatal — profile saved successfully; credits can be added manually
          console.warn('[Onboarding] free credits grant failed:', creditErr);
        }
      }

      toast.success('Profile saved! Welcome to Skootlink.');
      navigate('/home');
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const nextStep = () => {
    if (step === 1 && !validatePersonal()) return;
    if (step < STEPS.length - 1) { setStep(s => s + 1); return; }
    saveAndNavigate('home');
  };

  const currentStep = STEPS[step];
  const isSA        = form.country_type === 'South Africa';
  const cityList    = isSA && form.sa_province ? SA_PROVINCE_CITIES[form.sa_province] ?? [] : [];
  const cityIsOther = form.sa_city === '__other__';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">

        {/* Logo */}
        <div className="flex justify-center mb-6">
          <a href="/home" className="flex items-center gap-2">
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

          {/* ── Step 0: Role Selection ────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold text-lg">How will you use Skootlink?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Pick your role — you can update it any time in Settings.
                </p>
              </div>

              <div className="space-y-3">
                {ROLES.map((role) => {
                  const Icon = role.icon;
                  const selected = form.role === role.id;
                  return (
                    <div
                      key={role.id}
                      onClick={() => update('role', role.id)}
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all select-none ${
                        selected
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border hover:border-primary/40 hover:bg-accent/50'
                      }`}
                    >
                      <div className={`p-2.5 rounded-xl ${role.bg} ${role.border} border shrink-0`}>
                        <Icon className={`w-5 h-5 ${role.iconColor}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground">{role.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{role.description}</p>
                      </div>
                      {selected
                        ? <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                        : <div className="w-5 h-5 rounded-full border-2 border-muted shrink-0" />}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-start gap-2.5 bg-muted/50 rounded-xl p-3.5">
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Driver's licence verification costs 30 credits and can be done from Settings.
                  You can browse and list vehicles right after completing setup.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 1: Personal Info ─────────────────────────────────────── */}
          {step === 1 && (
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
                  <Label className="text-xs font-medium">
                    Date of Birth * <span className="text-muted-foreground font-normal">(must be 18 or older)</span>
                  </Label>
                  <Input className="mt-1" type="date" value={form.date_of_birth} onChange={e => update('date_of_birth', e.target.value)} max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]} />
                </div>

              </div>

              {/* Location */}
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

          {/* ── Navigation ────────────────────────────────────────────────── */}
          <div className="mt-6 pt-4 border-t border-border space-y-3">
            <div className="flex justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => step === 0 ? navigate('/home') : setStep(s => s - 1)}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>

              {step < STEPS.length - 1 ? (
                <Button onClick={nextStep} className="gap-2">
                  Continue <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button onClick={() => saveAndNavigate('home')} className="gap-2" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Get Started'}
                </Button>
              )}
            </div>

            {/* Skip — only shown on the final step */}
            {step === STEPS.length - 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => saveAndNavigate('home')}
                disabled={saving}
              >
                Skip for now
              </Button>
            )}
          </div>

        </Card>
      </div>
    </div>
  );
}
