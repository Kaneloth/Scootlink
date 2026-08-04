import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { geocodeLocation } from '@/lib/geocode';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldCheck, Loader2, Camera, Eye, EyeOff, Users, Image as ImageIcon } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import StarRating from '@/components/reviews/StarRating';
import { toast } from 'sonner';
import VerificationPanel from '@/components/verification/VerificationPanel';
import PlatformHistoryPanel from '@/components/profile/PlatformHistoryPanel';

function ProfileHeaderSkeleton() {
  return (
    <Card className="p-5 mb-4 border border-border/50 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-1/4" />
        </div>
      </div>
    </Card>
  );
}

function FormSkeleton() {
  return (
    <Card className="p-6 border border-border/50 animate-pulse">
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 bg-muted rounded w-20" />
            <div className="h-9 bg-muted rounded-md w-full" />
          </div>
        ))}
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 bg-muted rounded w-16" />
              <div className="h-9 bg-muted rounded-md w-full" />
            </div>
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 bg-muted rounded w-24" />
            <div className="h-9 bg-muted rounded-md w-full" />
          </div>
        ))}
        <div className="h-10 bg-muted rounded-md w-full" />
      </div>
    </Card>
  );
}

export default function Profile() {
  const navigate        = useNavigate();
  const [searchParams]  = useSearchParams();
  const defaultTab      = searchParams.get('tab') || 'edit';
  const fileInputRef    = useRef(null);
  const cameraInputRef  = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);

  const [user,          setUser]          = useState(null);
  const [userLoading,   setUserLoading]   = useState(true);
  const [avatarUrl,     setAvatarUrl]     = useState(null);
  const [avatarVisible, setAvatarVisible] = useState(true);
  const [profileVisible, setProfileVisible] = useState(true);
  const [savingVisibility, setSavingVisibility] = useState(null);
  const [profileVisibilityFeatureEnabled, setProfileVisibilityFeatureEnabled] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    gender: '',
    driving_experience: '',
    location: '',
    residential_address: '',
    license_number: '',
    license_year: '',
    citizenship: 'South African',
  });

  const [sensitiveForm, setSensitiveForm] = useState({
    sa_id: '',
    passport: '',
  });

  const [saving, setSaving] = useState(false);
  const [myReviews, setMyReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [accountType, setAccountType] = useState('driver');
  const [showRoleConfirm, setShowRoleConfirm] = useState(false);
  const [pendingRole, setPendingRole] = useState(null);

  const [sa_province, setSaProvince] = useState('');
  const [sa_city, setSaCity] = useState('');
  const [sa_city_other, setSaCityOther] = useState('');

  const SA_PROVINCE_CITIES = {
    'Eastern Cape': ['Aliwal North','Bhisho','East London','Gqeberha (Port Elizabeth)','Grahamstown','Humansdorp','Jeffreys Bay',"King William's Town",'Mthatha','Port Alfred','Queenstown','Stutterheim'],
    'Free State': ['Bethlehem','Bloemfontein','Ficksburg','Harrismith','Kroonstad','Parys','Phuthaditjhaba','Sasolburg','Virginia','Welkom'],
    'Gauteng': ['Alberton','Benoni','Boksburg','Carletonville','Centurion','Edenvale','Fourways','Germiston','Johannesburg','Kempton Park','Midrand','Pretoria','Randburg','Randfontein','Roodepoort','Sandton','Soweto','Springs','Vanderbijlpark','Vereeniging'],
    'KwaZulu-Natal': ['Ballito','Durban','Empangeni','Kloof','Ladysmith','Margate','Newcastle','Pietermaritzburg','Pinetown','Port Shepstone','Richards Bay','Stanger','Ulundi','Umhlanga','Vryheid','Westville'],
    'Limpopo': ['Bela-Bela','Giyani','Louis Trichardt','Modimolle','Mokopane','Musina','Phalaborwa','Polokwane','Thohoyandou','Tzaneen'],
    'Mpumalanga': ['Barberton','Ermelo','Graskop','Hazyview','Komatipoort','Malelane','Mbombela (Nelspruit)','Middelburg','Piet Retief','Sabie','Secunda','Witbank (eMalahleni)'],
    'North West': ['Brits','Hartbeespoort','Klerksdorp','Lichtenburg','Mahikeng','Potchefstroom','Rustenburg','Wolmaransstad','Zeerust'],
    'Northern Cape': ['Colesberg','De Aar','Kathu','Kimberley','Kuruman','Pofadder','Springbok','Upington'],
    'Western Cape': ['Beaufort West','Bellville','Cape Town','Durbanville','George','Hermanus','Knysna','Malmesbury','Mossel Bay','Oudtshoorn','Paarl','Saldanha','Somerset West','Stellenbosch','Strand','Swellendam','Vredenburg','Worcester'],
  };

  const cityList = sa_province ? (SA_PROVINCE_CITIES[sa_province] ?? []) : [];
  const cityIsOther = sa_city === '__other__';

  const parseLocationIntoDropdowns = (locationStr) => {
    if (!locationStr) return;
    const parts = locationStr.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const province = parts[parts.length >= 3 ? parts.length - 2 : 1];
      const city = parts[0];
      if (SA_PROVINCE_CITIES[province]) {
        setSaProvince(province);
        const cities = SA_PROVINCE_CITIES[province];
        if (cities.includes(city)) {
          setSaCity(city);
        } else {
          setSaCity('__other__');
          setSaCityOther(city);
        }
      }
    }
  };

  const buildLocation = () => {
    const city = sa_city === '__other__' ? sa_city_other : sa_city;
    return [city, sa_province, 'South Africa'].filter(Boolean).join(', ');
  };

  const handleRoleChange = (newRole) => {
    if (newRole === accountType) return;
    setPendingRole(newRole);
    setShowRoleConfirm(true);
  };

  const confirmRoleChange = async () => {
    if (!pendingRole || !user) return;
    try {
      await supabase.from('profiles').update({ account_type: pendingRole }).eq('id', user.id);
      await supabase.auth.updateUser({ data: { account_type: pendingRole } });
      setAccountType(pendingRole);
      setShowRoleConfirm(false);
      setPendingRole(null);
      toast.success(`Role updated to ${pendingRole}. Your dashboard will reflect this immediately.`);
      window.location.reload();
    } catch (err) {
      toast.error('Could not update role: ' + err.message);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifStatus = params.get('verif_payment');
    const service = params.get('service');
    if (verifStatus === 'success' && service) {
      toast.success('Payment received! You can now proceed with verification.');
    } else if (verifStatus === 'cancelled') {
      toast.info('Payment cancelled — verification was not started.');
    }
    if (verifStatus) {
      params.delete('verif_payment'); params.delete('service');
      const newUrl = window.location.pathname + (params.toString() ? `?${params}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  // Native handling of the co.za.skootlink.app://payment-result deep link
  // for verification payments now lives in VerificationPanel.jsx itself —
  // it owns the payment modal and the pendingVerify() continuation, and
  // needs to react the moment the Custom Tab closes (via browserFinished),
  // not just on mount, since this page never unmounts while the tab is open.

  const fetchMyReviews = async (userId) => {
    setReviewsLoading(true);
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, comment, created_at, target_type')
        .eq('target_id', userId)
        .order('created_at', { ascending: false });
      if (!error) setMyReviews(data || []);
    } catch { /* non-fatal */ } finally {
      setReviewsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('app_settings')
      .select('profile_visibility_toggle_enabled')
      .eq('id', 1)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        setProfileVisibilityFeatureEnabled(!error && data?.profile_visibility_toggle_enabled === true);
      })
      .catch(() => { if (!cancelled) setProfileVisibilityFeatureEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    auth.me()
      .then(async (u) => {
        if (cancelled) return;
        setUser(u);
        setAvatarUrl(u.avatar_url || null);
        fetchMyReviews(u.id);
        setAvatarVisible(u.avatar_visible !== false);
        setProfileVisible(u.profile_visible !== false);
        setAccountType(u.account_type || 'driver');
        parseLocationIntoDropdowns(u.location || '');
        setForm({
          full_name: u.full_name || '',
          email: u.email || '',
          phone: u.phone || '',
          gender: u.gender || '',
          driving_experience: u.driving_experience || '',
          location: u.location || '',
          residential_address: u.residential_address || '',
          license_number: u.license_number || '',
          license_year: u.license_year ? String(u.license_year) : '',
          citizenship: u.citizenship || 'South African',
        });
        const { data: sensitive } = await supabase
          .from('user_sensitive_info')
          .select('sa_id, passport')
          .eq('user_id', u.id)
          .maybeSingle();
        if (!cancelled && sensitive) {
          setSensitiveForm({
            sa_id: sensitive.sa_id || '',
            passport: sensitive.passport || '',
          });
        }
        if (u.location && !cancelled) {
          const { data: row } = await supabase
            .from('profiles')
            .select('geo_location')
            .eq('id', u.id)
            .single();
          if (!cancelled && !row?.geo_location) {
            try {
              const coords = await geocodeLocation(u.location);
              if (coords && !cancelled) {
                await supabase.rpc('set_user_geo_location', {
                  p_user_id: u.id,
                  p_lng:     coords.longitude,
                  p_lat:     coords.latitude,
                });
              }
            } catch { /* non-fatal */ }
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setUserLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setAvatarUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const ext      = file.name.split('.').pop() || 'jpg';
      const filePath = `${authUser.id}/avatar_${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('profile-images')
        .upload(filePath, file, { contentType: file.type });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage
        .from('profile-images')
        .getPublicUrl(filePath);
      setAvatarUrl(publicUrl);
      await auth.updateMe({ avatar_url: publicUrl });
      await supabase.from('profiles').upsert(
        { id: authUser.id, avatar_url: publicUrl },
        { onConflict: 'id' }
      );
      toast.success('Profile photo updated!');
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  const handleToggleAvatarVisible = async () => {
    const next = !avatarVisible;
    setAvatarVisible(next);
    setSavingVisibility('avatar');
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('Not signed in');
      await auth.updateMe({ avatar_visible: next });
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: authUser.id, avatar_visible: next }, { onConflict: 'id' });
      if (error) throw error;
      toast.success(next ? 'Photo is now visible to others' : 'Photo is now hidden from others');
    } catch (err) {
      setAvatarVisible(!next);
      toast.error('Could not update photo visibility: ' + err.message);
    } finally {
      setSavingVisibility(null);
    }
  };

  const handleToggleProfileVisible = async () => {
    const next = !profileVisible;
    setProfileVisible(next);
    setSavingVisibility('profile');
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('Not signed in');
      await auth.updateMe({ profile_visible: next });
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: authUser.id, profile_visible: next }, { onConflict: 'id' });
      if (error) throw error;
      toast.success(next ? 'Profile is now visible to others' : 'Profile is now hidden from search');
    } catch (err) {
      setProfileVisible(!next);
      toast.error('Could not update profile visibility: ' + err.message);
    } finally {
      setSavingVisibility(null);
    }
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!form.phone.trim()) { toast.error('Phone number is required'); return; }
    setSaving(true);
    const locationStr = buildLocation() || form.location || '';
    try {
      const checks = [];
      if (form.email?.trim()) {
        checks.push(
          supabase.from('profiles')
            .select('id')
            .ilike('email', form.email.trim())
            .neq('id', user.id)
            .limit(1)
            .then(({ data }) => data?.length > 0 ? 'email' : null)
        );
      }
      if (form.phone?.trim()) {
        checks.push(
          supabase.from('profiles')
            .select('id')
            .eq('phone', form.phone.trim())
            .neq('id', user.id)
            .limit(1)
            .then(({ data }) => data?.length > 0 ? 'phone' : null)
        );
      }
      const dupes = (await Promise.all(checks)).filter(Boolean);
      if (dupes.includes('email')) {
        toast.error('An account with this email address already exists.');
        setSaving(false); return;
      }
      if (dupes.includes('phone')) {
        toast.error('An account with this phone number already exists.');
        setSaving(false); return;
      }
      const metadataUpdates = {
        full_name: form.full_name,
        phone: form.phone,
        gender: form.gender,
        driving_experience: accountType !== 'owner' ? (form.driving_experience || null) : null,
        location: locationStr,
        residential_address: form.residential_address,
        license_number: form.license_number,
        license_year: form.license_year ? parseInt(form.license_year) : null,
        citizenship: form.citizenship,
      };
      await auth.updateMe(metadataUpdates);
      const { error: profileUpdateErr } = await supabase
        .from('profiles')
        .update({
          full_name:            form.full_name           || null,
          email:                form.email               || user.email || null,
          phone:                form.phone               || null,
          driving_experience:   accountType !== 'owner' ? (form.driving_experience || null) : null,
          location:             locationStr              || null,
          residential_address:  form.residential_address || null,
          license_year:         form.license_year        ? parseInt(form.license_year) : null,
          license_number:       form.license_number      || null,
          onboarding_completed: !!(form.full_name?.trim() && form.phone?.trim() && locationStr),
        })
        .eq('id', user.id);
      if (profileUpdateErr) {
        console.error('[Profile] profiles.update error:', profileUpdateErr);
        toast.error('Could not save profile: ' + profileUpdateErr.message);
        setSaving(false);
        return;
      }
      const submittedId = (
        form.citizenship === 'South African'
          ? sensitiveForm.sa_id
          : sensitiveForm.passport
      )?.trim().toUpperCase();
      if (submittedId) {
        const { data: bannedId } = await supabase
          .from('blacklisted_id_numbers')
          .select('id_number')
          .eq('id_number', submittedId)
          .maybeSingle();
        if (bannedId) {
          toast.error(
            'Your ID / passport number has been flagged. Please contact support at help@skootlink.co.za to resolve this.',
            { duration: 8000 }
          );
          setSaving(false);
          return;
        }
      }
      const { error: sensitiveError } = await supabase
        .from('user_sensitive_info')
        .upsert(
          {
            user_id: user.id,
            sa_id:    sensitiveForm.sa_id    || null,
            passport: sensitiveForm.passport || null,
          },
          { onConflict: 'user_id' }
        );
      if (sensitiveError) throw sensitiveError;
      let emailChangePending = false;
      if (form.email !== user.email) {
        const { error } = await supabase.auth.updateUser({ email: form.email });
        if (error) throw error;
        emailChangePending = true;
        toast.success('Confirmation email sent to ' + form.email + '. Click the link to activate your new address.');
      }
      if (form.location) {
        try {
          const coords = await geocodeLocation(form.location);
          if (coords) {
            const { error: rpcErr } = await supabase.rpc('set_user_geo_location', {
              p_user_id: user.id,
              p_lng:     coords.longitude,
              p_lat:     coords.latitude,
            });
            if (rpcErr) console.error('[Profile] set_user_geo_location RPC error:', rpcErr);
          }
        } catch (geoErr) { console.error('[Profile] geocode error:', geoErr); }
      }
      const freshUser = await auth.me().catch(() => null);
      if (freshUser) {
        setUser(freshUser);
        setAvatarUrl(freshUser.avatar_url || null);
        setAvatarVisible(freshUser.avatar_visible !== false);
        setProfileVisible(freshUser.profile_visible !== false);
        setForm({
          full_name:            freshUser.full_name || '',
          email:                freshUser.email || '',
          phone:                freshUser.phone || '',
          gender:               freshUser.gender || '',
          driving_experience:   freshUser.driving_experience || '',
          location:             freshUser.location || '',
          residential_address:  freshUser.residential_address || '',
          license_number:       freshUser.license_number || '',
          license_year:         freshUser.license_year ? String(freshUser.license_year) : '',
          citizenship:          freshUser.citizenship || 'South African',
        });
      }
      if (!emailChangePending) {
        toast.success('Profile updated!');
        navigate('/home');
      }
    } catch (err) {
      toast.error('Update failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const updateSensitive = (field, value) => setSensitiveForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="My Profile" subtitle="Edit details & view your reviews" backTo="/home" />

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

      {userLoading ? (
        <ProfileHeaderSkeleton />
      ) : user ? (
        <Card className="p-5 mb-4 border border-border/50">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  user.full_name?.[0] || 'U'
                )}
              </div>
              <button
                onClick={() => setShowPhotoMenu(v => !v)}
                disabled={avatarUploading}
                className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                title="Change photo"
              >
                {avatarUploading
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Camera className="w-3 h-3" />}
              </button>
              {showPhotoMenu && (
                <div className="absolute top-full right-0 mt-1 z-20 bg-card border border-border rounded-xl shadow-lg overflow-hidden w-40">
                  <button
                    onClick={() => { setShowPhotoMenu(false); cameraInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    <Camera className="w-4 h-4" /> Take Photo
                  </button>
                  <button
                    onClick={() => { setShowPhotoMenu(false); fileInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-accent transition-colors border-t border-border"
                  >
                    <ImageIcon className="w-4 h-4" /> Choose from Gallery
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-foreground">{user.full_name || 'User'}</h2>
                {user.verified && <ShieldCheck className="w-4 h-4 text-primary" />}
              </div>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <StarRating value={Math.round(user.rating || 0)} size="sm" showValue />
                {user.total_reviews > 0 && (
                  <span className="text-xs text-muted-foreground">({user.total_reviews} reviews)</span>
                )}
              </div>
              <button
                onClick={() => savingVisibility === null && handleToggleAvatarVisible()}
                disabled={savingVisibility === 'avatar'}
                className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
              >
                {avatarVisible
                  ? <><Eye className="w-3.5 h-3.5" /> Photo visible to others</>
                  : <><EyeOff className="w-3.5 h-3.5" /> Photo hidden from others</>}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {user && profileVisibilityFeatureEnabled && (
        <Card className="p-2 mb-4 border border-border/50">
          <div
            className={`flex items-center justify-between p-4 rounded-xl transition-colors ${savingVisibility === 'profile' ? 'opacity-60' : 'cursor-pointer hover:bg-accent'}`}
            onClick={() => savingVisibility === null && handleToggleProfileVisible()}
          >
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-muted-foreground" />
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">Profile Visibility</p>
                <p className="text-xs text-muted-foreground">
                  {profileVisible ? 'Visible in driver & vehicle search' : 'Hidden from search'}
                </p>
              </div>
            </div>
            <div className={`h-6 w-10 rounded-full relative transition-colors shrink-0 ${profileVisible ? 'bg-primary' : 'bg-gray-300'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${profileVisible ? 'right-1' : 'left-1'}`} />
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList className={`grid w-full mb-4 h-auto gap-1 ${accountType === 'owner' ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <TabsTrigger value="edit">Edit Info</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          {accountType !== 'owner' && <TabsTrigger value="platform-history">Platforms</TabsTrigger>}
          <TabsTrigger value="reviews-received">Reviews</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          {userLoading ? (
            <FormSkeleton />
          ) : (
            <Card className="p-6 border border-border/50">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Full Name <span className="text-red-500">*</span></Label>
                    <Input
                      className="mt-1"
                      value={form.full_name}
                      onChange={(e) => update('full_name', e.target.value)}
                      placeholder="Your full name"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Email</Label>
                    <Input
                      className="mt-1"
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                      placeholder="you@example.com"
                      type="email"
                    />
                    {form.email !== user?.email && (
                      <p className="text-[11px] text-amber-600 mt-1">
                        A confirmation email will be sent to verify your new address.
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Phone <span className="text-red-500">*</span></Label>
                    <Input
                      className="mt-1"
                      placeholder="+27 123 456 789"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Gender</Label>
                    <Select value={form.gender} onValueChange={(v) => update('gender', v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {accountType !== 'owner' && (
                    <div>
                      <Label>Driving Experience</Label>
                      <Select value={form.driving_experience} onValueChange={(v) => update('driving_experience', v)}>
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
                <div>
                  <Label>Province</Label>
                  <Select value={sa_province} onValueChange={(v) => { setSaProvince(v); setSaCity(''); setSaCityOther(''); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select province" /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(SA_PROVINCE_CITIES).sort().map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {sa_province && (
                  <div>
                    <Label>City / Town</Label>
                    <Select value={sa_city} onValueChange={setSaCity}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select city or town" /></SelectTrigger>
                      <SelectContent>
                        {cityList.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                        <SelectItem value="__other__">Other (type below)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {cityIsOther && (
                  <div>
                    <Label>Your city / town</Label>
                    <Input
                      className="mt-1"
                      placeholder="Enter your city or town"
                      value={sa_city_other}
                      onChange={e => setSaCityOther(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <Label>Residential Address</Label>
                  <Input
                    className="mt-1"
                    placeholder="123 Main St, Johannesburg"
                    value={form.residential_address}
                    onChange={(e) => update('residential_address', e.target.value)}
                  />
                </div>
                <div>
                  <Label>Account Role</Label>
                  <p className="text-xs text-muted-foreground mb-2">Switch your role if your needs have changed. Your dashboard will update immediately.</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'driver', label: '🏍️ Driver',    desc: 'Rent vehicles' },
                      { id: 'owner',  label: '🚗 Owner',     desc: 'List vehicles' },
                      { id: 'both',   label: '🔄 Both',      desc: 'Driver & owner' },
                    ].map(r => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleRoleChange(r.id)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          accountType === r.id
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <p className="text-sm font-semibold text-foreground">{r.label}</p>
                        <p className="text-[11px] text-muted-foreground">{r.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <Button onClick={handleSave} className="w-full" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="verification">
          <VerificationPanel
            user={user}
            accountType={accountType}
            onUserUpdated={async () => {
              const u = await auth.me();
              setUser(u);
            }}
          />
        </TabsContent>

        {accountType !== 'owner' && (
          <TabsContent value="platform-history">
            <PlatformHistoryPanel user={user} />
          </TabsContent>
        )}

        <TabsContent value="reviews-received">
          {reviewsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 rounded-xl border border-border/50 bg-muted animate-pulse" />
              ))}
            </div>
          ) : myReviews.length === 0 ? (
            <Card className="p-8 border border-border/50 text-center">
              <p className="text-3xl mb-3">⭐</p>
              <p className="font-semibold text-foreground mb-1">No reviews yet</p>
              <p className="text-sm text-muted-foreground">Reviews from owners and drivers will appear here after completed rentals.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {myReviews.map(review => (
                <Card key={review.id} className="p-4 border border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StarRating value={review.rating} size="sm" showValue />
                      {review.target_type && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                          as {review.target_type}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(review.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-foreground">{review.comment}</p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {showRoleConfirm && pendingRole && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-black/50 flex items-center justify-center p-4"
          onClick={() => { setShowRoleConfirm(false); setPendingRole(null); }}
        >
          <div
            className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 border border-border"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-foreground mb-2">Switch to {pendingRole.charAt(0).toUpperCase() + pendingRole.slice(1)}?</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Your dashboard and search experience will update immediately to reflect your new role. You can switch again at any time from your profile.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setShowRoleConfirm(false); setPendingRole(null); }}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={confirmRoleChange}>
                Switch Role
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
