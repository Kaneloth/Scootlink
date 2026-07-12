import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { createPortal } from 'react-dom';
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
  Star, Upload, X, Plus, Trash2, Camera, Image as ImageIcon, Car, ImagePlus,
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
const BASE_STEPS = [
  { id: 'role',     label: 'Your Role',    icon: Users },
  { id: 'personal', label: 'Personal Info', icon: User  },
];
const PHOTO_STEP = { id: 'photo', label: 'Profile Photo', icon: Camera };
const PLATFORM_STEP = { id: 'platform_history', label: 'Your Experience', icon: Star };
const VEHICLE_STEP = { id: 'vehicle', label: 'List a Vehicle', icon: Car };
const PLATFORM_OPTIONS = ['Uber', 'Bolt', 'Uber Eats', 'Mr D Food', 'Bolt Food', 'InDriver', 'Other'];

// ── Role options ──────────────────────────────────────────────────────────────
const ROLES = [
  {
    id: 'driver',
    name: 'Driver',
    description: 'Search for and rent vehicles listed by owners on Skootlink.',
    freeCredits: 350,
    icon: Bike,
    bg:   'bg-blue-50',
    border: 'border-blue-200',
    iconColor: 'text-blue-600',
  },
  {
    id: 'owner',
    name: 'Owner',
    description: 'List your vehicles and connect with verified drivers.',
    freeCredits: 1250,
    icon: Crown,
    bg:   'bg-amber-50',
    border: 'border-amber-200',
    iconColor: 'text-amber-600',
  },
  {
    id: 'both',
    name: 'Driver & Owner',
    description: 'Drive other vehicles and list your own — full platform access.',
    freeCredits: 1250,
    icon: Users,
    bg:   'bg-primary/5',
    border: 'border-primary/30',
    iconColor: 'text-primary',
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep]   = useState(0);

  // TEMPORARY diagnostic overlay — catches any JS error and shows it
  // directly on screen. Safe to remove once the frozen-buttons bug is
  // found; harmless if it never fires.
  const [debugErrors, setDebugErrors] = useState([]);
  useEffect(() => {
    const onError = (e) => {
      setDebugErrors(prev => [...prev, `ERROR: ${e.message} (${e.filename}:${e.lineno})`].slice(-5));
    };
    const onRejection = (e) => {
      setDebugErrors(prev => [...prev, `UNHANDLED PROMISE: ${e.reason?.message || e.reason}`].slice(-5));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);


  // Android hardware back button — without this, Capacitor's default
  // behavior (history.back(), a real route change) fires instead, which has
  // nothing to do with onboarding's own step state. That mismatch is what
  // was causing Next/Back to become unresponsive: the app would navigate
  // away from /onboarding via browser history while this component's
  // internal state didn't necessarily reset to match, leaving things out of
  // sync on the next visit. This makes hardware back behave identically to
  // the on-screen Back button and stops the default behavior from also
  // running alongside it.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        listener = await CapApp.addListener('backButton', () => {
          setStep(s => {
            if (s === 0) {
              navigate('/home');
              return s;
            }
            return s - 1;
          });
        });
      } catch (e) { /* not in Capacitor environment */ }
    })();
    return () => { if (listener) listener.remove().catch(() => {}); };
  }, [navigate]);

  const [saving, setSaving] = useState(false);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(false);

  // ── Profile photo (camera or gallery) ────────────────────────────────────
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setAvatarUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const ext = file.name.split('.').pop() || 'jpg';
      const filePath = `${authUser.id}/avatar_${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('profile-images')
        .upload(filePath, file, { contentType: file.type });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage
        .from('profile-images')
        .getPublicUrl(filePath);
      setAvatarUrl(publicUrl);
      toast.success('Photo added!');
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  const [currentEmail, setCurrentEmail] = useState('');
  const [currentFullName, setCurrentFullName] = useState('');

  useEffect(() => {
    auth.me().then(u => {
      if (u?.email) setCurrentEmail(u.email);
      if (u?.full_name) setCurrentFullName(u.full_name);
    }).catch(() => {});
  }, []);

  const [form, setForm] = useState({
    role:                'driver',
    phone:               '',
    gender:              '',
    date_of_birth:       '',
    driving_experience:  '',
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

  // Owners-only accounts skip the platform history step — it's specific to
  // gig driving/delivery work, not vehicle listing. Owner and "both"
  // accounts get an extra step to list their first vehicle right here,
  // since deferring it to after onboarding is exactly what causes people to
  // never actually get around to it.
  const canListVehicles = form.role === 'owner' || form.role === 'both';
  const STEPS = [
    ...BASE_STEPS,
    PHOTO_STEP,
    ...(form.role === 'owner' ? [] : [PLATFORM_STEP]),
    ...(canListVehicles ? [VEHICLE_STEP] : []),
  ];

  // ── Platform history (self-reported, optional) ────────────────────────────
  const [platformEntries, setPlatformEntries] = useState([]); // { platform, role, rating, evidenceFile, requestVerification }
  const [newEntry, setNewEntry] = useState({ platform: '', otherPlatform: '', role: '', rating: 0, evidenceFile: null, requestVerification: false });
  const [savingPlatformHistory, setSavingPlatformHistory] = useState(false);

  const resetNewEntry = () => setNewEntry({ platform: '', otherPlatform: '', role: '', rating: 0, evidenceFile: null, requestVerification: false });

  // ── Vehicle listing (owner/both accounts only) ───────────────────────────
  const [vehicleForm, setVehicleForm] = useState({
    vehicle_type:           'scooter',
    make:                   '',
    model:                  '',
    year:                   '',
    color:                  '',
    transmission:           '',
    plate:                  '',
    location:               '',
    price_per_week:         '',
    deposit:                '',
    storage_type:           'owner_address',
    pickup_return_location: '',
  });
  const [vehicleImages, setVehicleImages] = useState([]);
  const [vehicleUploading, setVehicleUploading] = useState(false);

  const updateVehicle = (field, value) => setVehicleForm(prev => {
    const next = { ...prev, [field]: value };
    if (field === 'vehicle_type' && value === 'bicycle') next.transmission = '';
    return next;
  });

  const handleVehicleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - vehicleImages.length);
    if (!files.length) return;
    setVehicleUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const urls = [];
      for (const file of files) {
        const filePath = `${authUser.id}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('vehicle-images').upload(filePath, file, { upsert: true, contentType: file.type });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('vehicle-images').getPublicUrl(filePath);
        urls.push(publicUrl);
      }
      setVehicleImages(prev => [...prev, ...urls]);
    } catch (err) {
      toast.error('Image upload failed: ' + err.message);
    } finally {
      setVehicleUploading(false);
      e.target.value = '';
    }
  };

  // A vehicle is only actually created if the person filled in the fields
  // that matter — if they left this step blank (skipped it via Next), this
  // correctly does nothing rather than inserting an empty listing.
  const hasVehicleToSave = !!(vehicleForm.make && vehicleForm.model && vehicleForm.plate && vehicleForm.location && vehicleForm.price_per_week);

  const saveVehicleListing = async (ownerId) => {
    if (!hasVehicleToSave) return false;
    try {
      const dbRow = { ...vehicleForm };
      dbRow.type = dbRow.vehicle_type; delete dbRow.vehicle_type;
      dbRow.price = parseFloat(dbRow.price_per_week) || 0; delete dbRow.price_per_week;
      dbRow.year = parseInt(dbRow.year) || 2024;
      dbRow.deposit = parseFloat(dbRow.deposit) || 0;
      dbRow.images = vehicleImages;
      dbRow.rating = 0;
      dbRow.total_reviews = 0;
      dbRow.status = 'available';
      dbRow.owner_id = ownerId;

      if (dbRow.location) {
        try {
          const coords = await geocodeLocation(dbRow.location);
          if (coords) dbRow.geo_location = `SRID=4326;POINT(${coords.longitude} ${coords.latitude})`;
        } catch { /* non-fatal — vehicle still lists without coordinates */ }
      }

      // Deliberately free — no credit check, no deduction. This is the
      // person's very first listing, created in the same flow meant to
      // reduce drop-off; charging for it here (and being able to fail if
      // their sign-up credit grant hasn't landed yet, e.g. due to an
      // IP-based false positive) would work against the entire point.
      // Every vehicle listed after onboarding still goes through the normal
      // tiered pricing via the regular Add Vehicle page, unaffected by this.
      const { error } = await supabase.from('vehicles').insert(dbRow).select('*').single();
      if (error) throw error;

      toast.success('Vehicle listed!');
      return true;
    } catch (err) {
      console.error('[Onboarding] Vehicle save failed:', err);
      toast.error("Vehicle wasn't listed — you can add it from your Briefcase any time.");
      return false;
    }
  };


  const addPlatformEntry = () => {
    const platformName = newEntry.platform === 'Other' ? newEntry.otherPlatform.trim() : newEntry.platform;
    if (!platformName) { toast.error('Please select or enter a platform name'); return; }
    if (!newEntry.rating) { toast.error('Please select a rating'); return; }
    if (newEntry.requestVerification && !newEntry.evidenceFile) {
      toast.error('Please upload a screenshot to request verification'); return;
    }
    setPlatformEntries(prev => {
      const existingIndex = prev.findIndex(e => e.platform.toLowerCase() === platformName.toLowerCase());
      const updatedEntry = { ...newEntry, platform: platformName };
      if (existingIndex !== -1) {
        toast.info(`Updated your existing ${platformName} entry`);
        return prev.map((e, i) => i === existingIndex ? updatedEntry : e);
      }
      return [...prev, updatedEntry];
    });
    resetNewEntry();
  };

  const removePlatformEntry = (index) => {
    setPlatformEntries(prev => prev.filter((_, i) => i !== index));
  };

  // Persists all locally-added platform entries to the database, uploading
  // evidence screenshots for any marked for verification. Called once, right
  // before finishing onboarding — never blocks navigation if it fails, since
  // this is optional, supplementary information.
  //
  // Accepts an explicit `entries` list (defaulting to the current state)
  // rather than always reading platformEntries directly — this lets the
  // caller pass in a list that also includes a not-yet-"Added" pending
  // entry still sitting in the form, without waiting on an async state
  // update to land first.
  const savePlatformHistoryEntries = async (userId, entries = platformEntries) => {
    if (entries.length === 0 || !userId) return;
    setSavingPlatformHistory(true);
    try {
      for (const entry of entries) {
        const { data: row, error: insertErr } = await supabase
          .from('platform_history')
          .upsert({
            user_id: userId,
            platform: entry.platform,
            role: entry.role || null,
            rating: entry.rating,
            verification_status: entry.requestVerification ? 'pending' : 'unverified',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,platform' })
          .select()
          .single();

        if (insertErr) { console.warn('[Onboarding] platform_history insert failed:', insertErr); continue; }

        if (entry.requestVerification && entry.evidenceFile && row) {
          const ext = entry.evidenceFile.name.split('.').pop() || 'png';
          const filePath = `${userId}/${row.id}.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from('platform-evidence')
            .upload(filePath, entry.evidenceFile, { contentType: entry.evidenceFile.type });
          if (uploadErr) {
            console.warn('[Onboarding] evidence upload failed:', uploadErr);
          } else {
            const { error: linkErr } = await supabase
              .from('platform_history')
              .update({ evidence_url: filePath })
              .eq('id', row.id);
            if (linkErr) console.warn('[Onboarding] failed to link evidence_url:', linkErr);
          }
        }
      }
    } catch (err) {
      console.warn('[Onboarding] savePlatformHistoryEntries failed:', err);
    } finally {
      setSavingPlatformHistory(false);
    }
  };

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
    full_name:            currentFullName || undefined, // write through from signup metadata so profiles.full_name is set immediately
    phone:                normalisePhone(form.phone),
    gender:               form.gender,
    date_of_birth:        form.date_of_birth || null,
    driving_experience:   form.role !== 'owner' ? (form.driving_experience || null) : null,
    location:             buildLocation(),
    residential_address:  form.residential_address,
    onboarding_completed: true,
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
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

  // ── Award sign-up free credits via Netlify function ──────────────────────
  // Uses grant-signup-credits.js which guards against duplicate grants (same
  // user_id, email, phone, device, or IP) — so this is always safe to call,
  // even more than once for the same user; a second call for someone who
  // already has a grant just returns { granted: 0, reason: 'already_granted' }.
  // Called as soon as a role is selected (see nextStep), not gated behind
  // completing the rest of onboarding — someone who picks a role and never
  // finishes their profile still gets their bonus.
  const awardSignupCredits = async (role, phone = '', vehicleListed = false) => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser?.id) return;
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('https://skootlink.co.za/.netlify/functions/grant-signup-credits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          user_id:            authUser.id,
          email:              authUser.email ?? '',
          phone:              phone ?? '',
          device_fingerprint: localStorage.getItem('skootlink_device_fp') ?? '',
          profile_type:       role,
          vehicle_listed:     vehicleListed,
        }),
      });
    } catch (creditErr) {
      // Non-fatal — credits can be added manually if this ever fails
      console.warn('[Onboarding] grant-signup-credits call failed:', creditErr);
    }
  };

  const saveAndNavigate = async (destination) => {
    setSaving(true);
    try {
      // Check for duplicate phone number before saving
      if (form.phone?.trim()) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('phone', normalisePhone(form.phone))
          .neq('id', authUser?.id)
          .limit(1);
        if (existing?.length > 0) {
          toast.error('An account with this phone number already exists. Please use a different number.');
          setSaving(false);
          return;
        }
      }

      // Fetch fresh auth metadata right before saving — guarantees full_name
      // is current even if the earlier auth.me() call hadn't resolved yet
      // when this step was reached.
      const { data: { user: freshAuthUser } } = await supabase.auth.getUser();
      const freshFullName = freshAuthUser?.user_metadata?.full_name || currentFullName;
      const freshEmail = freshAuthUser?.email || currentEmail;

      await auth.updateMe({
        ...buildProfilePayload(),
        full_name: freshFullName || undefined,
        email:     freshEmail || undefined,
      });
      const { data: { user: authUser } } = await supabase.auth.getUser();
      // Write residential_address directly to profiles — auth.updateMe() does not sync it
      if (authUser?.id && form.residential_address) {
        await supabase.from('profiles').update({
          residential_address: form.residential_address,
        }).eq('id', authUser.id);
      }
      await saveGeoLocation(buildLocation(), authUser?.id);

      // ── Verify the role actually persisted — if not, force-correct it ────
      // Defends against any residual race between Supabase auth side-effects
      // and our profiles write. Without this, a user could silently end up
      // with the wrong account_type in the database.
      if (authUser?.id) {
        const { data: verifyProfile } = await supabase
          .from('profiles')
          .select('account_type')
          .eq('id', authUser.id)
          .single();

        if (verifyProfile?.account_type !== form.role) {
          console.warn('[Onboarding] account_type mismatch after save — correcting:', verifyProfile?.account_type, '→', form.role);
          await supabase
            .from('profiles')
            .update({ account_type: form.role })
            .eq('id', authUser.id);
        }
      }

      // ── Save platform history (optional, self-reported) ───────────────────
      if (authUser?.id) {
        // If the user filled in a platform entry but never explicitly clicked
        // "Add Platform" before finishing onboarding, don't silently discard
        // it — auto-include it, since this is the last step and it's easy to
        // assume filling the form was enough. This is the actual bug fix:
        // previously, anything left in the form-in-progress was lost here.
        let entriesToSave = platformEntries;
        const pendingPlatformName = newEntry.platform === 'Other' ? newEntry.otherPlatform.trim() : newEntry.platform;
        if (pendingPlatformName && newEntry.rating) {
          const alreadyAdded = platformEntries.some(e => e.platform.toLowerCase() === pendingPlatformName.toLowerCase());
          if (!alreadyAdded) {
            entriesToSave = [...platformEntries, { ...newEntry, platform: pendingPlatformName }];
          }
        }
        await savePlatformHistoryEntries(authUser.id, entriesToSave);
      }

      // ── List the vehicle first, if they added one on that step (free —
      // see saveVehicleListing for why) ──────────────────────────────────────
      let vehicleActuallyListed = false;
      if (authUser?.id && canListVehicles) {
        vehicleActuallyListed = await saveVehicleListing(authUser.id);
      }

      // ── Award sign-up free credits ─────────────────────────────────────────
      // This is now the only place credits are granted — deferred to actual
      // onboarding completion (not the earlier role-selection step) so we
      // know whether they used the free vehicle listing before deciding the
      // amount. Based on whether the listing actually succeeded, not just
      // whether the form had data in it — if the insert failed for some
      // reason, they still get the full amount rather than coming up short.
      // Trade-off: someone who abandons onboarding partway through no longer
      // gets any credits at all, whereas they previously would have (a
      // deliberate choice — see conversation with Kanelo).
      if (authUser?.id) {
        await awardSignupCredits(form.role, form.phone, vehicleActuallyListed);
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
    if (step < STEPS.length - 1) {
      const nextIndex = step + 1;
      setStep(nextIndex);
      // Show privacy notice when entering Personal Info step
      if (nextIndex === 1) setShowPrivacyNotice(true);
      return;
    }
    saveAndNavigate('home');
  };

  const currentStep = STEPS[step];

  const isSA        = form.country_type === 'South Africa';
  const cityList    = isSA && form.sa_province ? SA_PROVINCE_CITIES[form.sa_province] ?? [] : [];
  const cityIsOther = form.sa_city === '__other__';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      {/* TEMPORARY diagnostic overlay — remove once the frozen-buttons bug is found */}
      <div className="fixed top-0 left-0 right-0 z-[999999] bg-black/90 text-green-400 text-[9px] font-mono p-1.5">
        step={step} | showPrivacyNotice={String(showPrivacyNotice)} | body.pointerEvents="{document.body.style.pointerEvents}"
      </div>
      {debugErrors.length > 0 && (
        <div className="fixed top-6 left-0 right-0 z-[999999] bg-red-950 text-red-100 text-[10px] font-mono p-2 max-h-40 overflow-y-auto">
          {debugErrors.map((err, i) => <div key={i} className="mb-1 border-b border-red-800 pb-1">{err}</div>)}
          <button onClick={() => setDebugErrors([])} className="text-red-300 underline">clear</button>
        </div>
      )}
      <div className="w-full max-w-xl">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <a href="/home" className="flex items-center gap-2">
            <img src="/favicon.png" alt="Skootlink" className="w-9 h-9" />
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
                      onClick={() => {
                        setDebugErrors(prev => [...prev, `ROLE CARD CLICKED: ${role.id}`].slice(-5));
                        update('role', role.id);
                      }}
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
                  Driver's licence verification is a paid service and can be done from your Profile.
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

                {/* Driving Experience — driver/both only */}
                {form.role !== 'owner' && (
                  <div className="col-span-2">
                    <Label className="text-xs font-medium">Driving Experience</Label>
                    <Select value={form.driving_experience} onValueChange={v => update('driving_experience', v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1-2">1 – 2 years</SelectItem>
                        <SelectItem value="3-5">3 – 5 years</SelectItem>
                        <SelectItem value="6+">6+ years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
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

          {STEPS[step]?.id === 'photo' && (
            <div className="space-y-5">
              <div>
                <h2 className="font-semibold text-lg">Add a Profile Photo</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  A real photo helps owners and drivers trust who they're dealing with.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={handleAvatarUpload}
              />

              <div className="flex flex-col items-center gap-4 py-2">
                <div className="w-28 h-28 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border-2 border-dashed border-border">
                  {avatarUploading ? (
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  ) : avatarUrl ? (
                    <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-8 h-8 text-primary/50" />
                  )}
                </div>

                <div className="flex gap-3 w-full">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 gap-2"
                    disabled={avatarUploading}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="w-4 h-4" /> Take Photo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 gap-2"
                    disabled={avatarUploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImageIcon className="w-4 h-4" /> Gallery
                  </Button>
                </div>
              </div>
            </div>
          )}

          {STEPS[step]?.id === 'platform_history' && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground -mt-2">
                Worked with Uber, Bolt, or a delivery app before? Adding your rating history helps owners trust you faster.
              </p>

              {/* Already-added entries */}
              {platformEntries.length > 0 && (
                <div className="space-y-2">
                  {platformEntries.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-muted">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{entry.platform}</span>
                        <span className="flex items-center gap-0.5 text-amber-500 text-xs">
                          <Star className="w-3.5 h-3.5 fill-current" /> {entry.rating.toFixed(1)}
                        </span>
                        {entry.requestVerification && (
                          <span className="text-[10px] text-primary font-medium">Verification requested</span>
                        )}
                      </div>
                      <button onClick={() => removePlatformEntry(i)} className="p-1 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add-entry form */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div>
                  <Label className="text-xs font-medium">Platform</Label>
                  <Select value={newEntry.platform} onValueChange={v => setNewEntry(p => ({ ...p, platform: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select a platform" /></SelectTrigger>
                    <SelectContent>
                      {PLATFORM_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {newEntry.platform === 'Other' && (
                  <div>
                    <Label className="text-xs font-medium">Platform Name</Label>
                    <Input className="mt-1" placeholder="e.g. DiDi" value={newEntry.otherPlatform} onChange={e => setNewEntry(p => ({ ...p, otherPlatform: e.target.value }))} />
                  </div>
                )}

                <div>
                  <Label className="text-xs font-medium">Your Rating</Label>
                  <div className="flex gap-1 mt-1">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} type="button" onClick={() => setNewEntry(p => ({ ...p, rating: n }))}>
                        <Star className={`w-7 h-7 ${n <= newEntry.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-medium">Role</Label>
                  <Input className="mt-1" placeholder="e.g. Driver, Courier" value={newEntry.role} onChange={e => setNewEntry(p => ({ ...p, role: e.target.value }))} />
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newEntry.requestVerification}
                    onChange={e => setNewEntry(p => ({ ...p, requestVerification: e.target.checked }))}
                  />
                  Request verification (free — reviewed manually by our team)
                </label>

                {newEntry.requestVerification && (
                  <div>
                    <Label className="text-xs font-medium">Upload a screenshot of your rating</Label>
                    <label className="mt-1 flex items-center gap-2 border border-dashed border-border rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-colors">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => setNewEntry(p => ({ ...p, evidenceFile: e.target.files[0] || null }))}
                      />
                      <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        {newEntry.evidenceFile ? newEntry.evidenceFile.name : 'Tap to choose an image'}
                      </span>
                    </label>
                  </div>
                )}

                <Button type="button" variant="outline" onClick={addPlatformEntry} className="w-full gap-2">
                  <Plus className="w-4 h-4" /> Add Platform
                </Button>
              </div>
            </div>
          )}

          {STEPS[step]?.id === 'vehicle' && (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold text-lg">List Your First Vehicle</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Get it in front of drivers right away — you can always add more later from your Briefcase.
                </p>
              </div>

              <div>
                <Label className="text-xs font-medium">Vehicle Type</Label>
                <Select value={vehicleForm.vehicle_type} onValueChange={v => updateVehicle('vehicle_type', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72 overflow-y-auto">
                    <SelectItem value="scooter">🛵 Scooter</SelectItem>
                    <SelectItem value="motorcycle">🏍️ Motorcycle</SelectItem>
                    <SelectItem value="bicycle">🚲 Bicycle</SelectItem>
                    <SelectItem value="car">🚗 Car</SelectItem>
                    <SelectItem value="suv">🚙 SUV</SelectItem>
                    <SelectItem value="bakkie">🛻 Bakkie / Pickup</SelectItem>
                    <SelectItem value="van">🚐 Van</SelectItem>
                    <SelectItem value="minibus_taxi">🚌 Minibus / Taxi</SelectItem>
                    <SelectItem value="truck">🚚 Truck</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Make</Label>
                  <Input className="mt-1" placeholder="Honda" value={vehicleForm.make} onChange={e => updateVehicle('make', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs font-medium">Model</Label>
                  <Input className="mt-1" placeholder="PCX 150" value={vehicleForm.model} onChange={e => updateVehicle('model', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Year</Label>
                  <Input className="mt-1" type="number" placeholder="2024" value={vehicleForm.year} onChange={e => updateVehicle('year', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs font-medium">License Plate</Label>
                  <Input className="mt-1" placeholder="ABC 123 GP" value={vehicleForm.plate} onChange={e => updateVehicle('plate', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Color</Label>
                  <Input className="mt-1" placeholder="White" value={vehicleForm.color} onChange={e => updateVehicle('color', e.target.value)} />
                </div>
                {vehicleForm.vehicle_type !== 'bicycle' && (
                  <div>
                    <Label className="text-xs font-medium">Transmission</Label>
                    <Select value={vehicleForm.transmission} onValueChange={v => updateVehicle('transmission', v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="automatic">Automatic</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs font-medium">Location</Label>
                <Input className="mt-1" placeholder="Johannesburg CBD" value={vehicleForm.location} onChange={e => updateVehicle('location', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Storage Type</Label>
                  <Select value={vehicleForm.storage_type} onValueChange={v => updateVehicle('storage_type', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner_address">Owner's Address</SelectItem>
                      <SelectItem value="driver_responsibility">Driver's Responsibility</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium">Pickup/Return Address</Label>
                  <Input className="mt-1" placeholder="123 Main St" value={vehicleForm.pickup_return_location} onChange={e => updateVehicle('pickup_return_location', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-medium">Weekly Price (ZAR)</Label>
                  <Input className="mt-1" type="number" placeholder="500" value={vehicleForm.price_per_week} onChange={e => updateVehicle('price_per_week', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs font-medium">Deposit (ZAR)</Label>
                  <Input className="mt-1" type="number" placeholder="1000" value={vehicleForm.deposit} onChange={e => updateVehicle('deposit', e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Photos (up to 3)</Label>
                <div className="mt-2 flex gap-3 flex-wrap">
                  {vehicleImages.map((img, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden group">
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setVehicleImages(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  ))}
                  {vehicleImages.length < 3 && (
                    <label className="w-20 h-20 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                      {vehicleUploading ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      ) : (
                        <>
                          <ImagePlus className="w-5 h-5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground mt-1">Add</span>
                        </>
                      )}
                      <input type="file" accept="image/*" className="hidden" onChange={handleVehicleImageUpload} />
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Navigation ────────────────────────────────────────────────── */}
          <div className="mt-6 pt-4 border-t border-border space-y-3">
            <div className="flex justify-between items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDebugErrors(prev => [...prev, `BACK CLICKED at step=${step}`].slice(-5));
                  step === 0 ? navigate('/home') : setStep(s => s - 1);
                }}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>

              {step < STEPS.length - 1 ? (
                <Button onClick={() => { setDebugErrors(prev => [...prev, `CONTINUE CLICKED at step=${step}`].slice(-5)); nextStep(); }} className="gap-2">
                  Continue <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button onClick={() => saveAndNavigate('home')} className="gap-2" disabled={saving || savingPlatformHistory}>
                  {(saving || savingPlatformHistory) ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {(saving || savingPlatformHistory) ? 'Saving...' : 'Get Started'}
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

      {/* Privacy notice modal — shown when user enters the Personal Info step */}
      {showPrivacyNotice && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 border border-border">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-2xl">🔒</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Your privacy matters</h2>
                <p className="text-xs text-muted-foreground">About the information we collect</p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <p className="text-sm text-foreground leading-relaxed">
                The personal details you provide on this screen — such as your date of birth and residential address — are collected <strong>for verification and platform control purposes only</strong>.
              </p>
              <p className="text-sm text-foreground leading-relaxed">
                This information is <strong>never displayed publicly</strong> to other users. Only your name, gender, location area, and profile photo will be visible to others on the platform.
              </p>
              <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
                <p className="text-xs text-primary leading-relaxed">
                  🛡️ Your data is stored securely and handled in accordance with applicable data protection laws. You can request deletion at any time from your Settings.
                </p>
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => setShowPrivacyNotice(false)}
            >
              I understand — proceed
            </Button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
