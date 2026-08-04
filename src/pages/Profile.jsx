import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  User, Camera, Loader2, ShieldCheck, Star, Eye, EyeOff, CheckCircle2,
  Upload, X, Clock, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/layout/PageHeader';
import ImageLightbox from '@/components/ui/ImageLightbox';

export default function Profile() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'verification' ? 'verification' : 'details';

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const [form, setForm] = useState({
    full_name: '', location: '', residential_address: '',
  });

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(null);

  // Profile visibility (search discoverability) toggle
  const [profileVisible, setProfileVisible] = useState(true);
  const [visibilityUpdating, setVisibilityUpdating] = useState(false);
  // Whether the admin has enabled this feature at all — while false, the
  // toggle itself is hidden entirely (not just disabled), matching the
  // Crosssa pattern. Defaults to false (hidden) until the fetch confirms
  // otherwise, so there's no flash of the toggle before the setting loads.
  const [profileVisibilityFeatureEnabled, setProfileVisibilityFeatureEnabled] = useState(false);

  // Identity verification state
  const [idSubmission, setIdSubmission] = useState(null);
  const [licenceSubmission, setLicenceSubmission] = useState(null);
  const [idFile, setIdFile] = useState(null);
  const [licenceFile, setLicenceFile] = useState(null);
  const [submittingId, setSubmittingId] = useState(false);
  const [submittingLicence, setSubmittingLicence] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const u = await auth.me();
        setUser(u);
        setForm({
          full_name: u.full_name || '',
          location: u.location || '',
          residential_address: u.residential_address || '',
        });
        setAvatarUrl(u.avatar_url || null);
        setProfileVisible(u.profile_visible !== false);

        // Public-read app_settings — no auth needed, just a direct select.
        try {
          const { data: settings } = await supabase
            .from('app_settings')
            .select('profile_visibility_toggle_enabled')
            .eq('id', 1)
            .single();
          setProfileVisibilityFeatureEnabled(settings?.profile_visibility_toggle_enabled === true);
        } catch {
          // If this fails for any reason, stay hidden — fail closed, not open,
          // given the whole point is preventing everyone from going incognito
          // by default.
          setProfileVisibilityFeatureEnabled(false);
        }

        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser?.id) {
          const [{ data: idSub }, { data: licSub }] = await Promise.all([
            supabase.from('identity_verification_submissions').select('*').eq('user_id', authUser.id).eq('doc_type', 'id').order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('identity_verification_submissions').select('*').eq('user_id', authUser.id).eq('doc_type', 'licence').order('created_at', { ascending: false }).limit(1).maybeSingle(),
          ]);
          setIdSubmission(idSub);
          setLicenceSubmission(licSub);
        }
      } catch (err) {
        toast.error('Failed to load profile: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setAvatarUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const ext = file.name.split('.').pop() || 'jpg';
      const filePath = `${authUser.id}/avatar_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('profile-images').upload(filePath, file, { contentType: file.type });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('profile-images').getPublicUrl(filePath);
      await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', authUser.id);
      setAvatarUrl(publicUrl);
      toast.success('Photo updated!');
    } catch (err) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await auth.updateMe(form);
      toast.success('Profile updated!');
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProfileVisible = async () => {
    const next = !profileVisible;
    setProfileVisible(next); // optimistic
    setVisibilityUpdating(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      await supabase.from('profiles').update({ profile_visible: next }).eq('id', authUser.id);
      toast.success(next ? 'Your profile is now visible in search.' : 'Your profile is now hidden from search.');
    } catch (err) {
      setProfileVisible(!next); // revert on failure
      toast.error('Failed to update: ' + err.message);
    } finally {
      setVisibilityUpdating(false);
    }
  };

  const handleIdSubmit = async () => {
    if (!idFile) { toast.error('Please choose a file first'); return; }
    setSubmittingId(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const ext = idFile.name.split('.').pop() || 'jpg';
      const filePath = `${authUser.id}/id_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('identity-documents').upload(filePath, idFile, { contentType: idFile.type });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('identity_verification_submissions').insert({
        user_id: authUser.id, doc_type: 'id', file_path: filePath, status: 'pending',
      });
      if (insErr) throw insErr;
      toast.success('ID submitted for verification!');
      setIdFile(null);
      const { data } = await supabase.from('identity_verification_submissions').select('*').eq('user_id', authUser.id).eq('doc_type', 'id').order('created_at', { ascending: false }).limit(1).maybeSingle();
      setIdSubmission(data);
    } catch (err) {
      toast.error('Submission failed: ' + err.message);
    } finally {
      setSubmittingId(false);
    }
  };

  const handleLicenceSubmit = async () => {
    if (!licenceFile) { toast.error('Please choose a file first'); return; }
    setSubmittingLicence(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const ext = licenceFile.name.split('.').pop() || 'jpg';
      const filePath = `${authUser.id}/licence_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('identity-documents').upload(filePath, licenceFile, { contentType: licenceFile.type });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('identity_verification_submissions').insert({
        user_id: authUser.id, doc_type: 'licence', file_path: filePath, status: 'pending',
      });
      if (insErr) throw insErr;
      toast.success('Licence submitted for verification!');
      setLicenceFile(null);
      const { data } = await supabase.from('identity_verification_submissions').select('*').eq('user_id', authUser.id).eq('doc_type', 'licence').order('created_at', { ascending: false }).limit(1).maybeSingle();
      setLicenceSubmission(data);
    } catch (err) {
      toast.error('Submission failed: ' + err.message);
    } finally {
      setSubmittingLicence(false);
    }
  };

  const renderVerificationStatus = (submission, verifiedFlag) => {
    if (verifiedFlag) {
      return <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> Verified</span>;
    }
    if (submission?.status === 'pending') {
      return <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><Clock className="w-3.5 h-3.5" /> Pending review</span>;
    }
    if (submission?.status === 'rejected') {
      return <span className="flex items-center gap-1 text-xs text-red-600 font-medium"><XCircle className="w-3.5 h-3.5" /> Rejected — please resubmit</span>;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-24">
      <PageHeader title="Profile" subtitle="Manage your account details" backTo="/home" />

      <Tabs defaultValue={initialTab}>
        <TabsList className="grid w-full grid-cols-2 max-w-xs mb-6">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-5">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleAvatarUpload} />
            <div
              className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border-2 border-border cursor-pointer relative group"
              onClick={() => avatarUrl && setLightboxSrc(avatarUrl)}
            >
              {avatarUploading ? (
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              ) : avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-primary/50" />
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={avatarUploading} onClick={() => cameraInputRef.current?.click()}>
                <Camera className="w-3.5 h-3.5" /> Camera
              </Button>
              <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={avatarUploading} onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" /> Upload
              </Button>
            </div>
          </div>

          {/* Basic details */}
          <Card className="p-4 space-y-4">
            <div>
              <Label className="text-xs font-medium">Full Name</Label>
              <Input className="mt-1" value={form.full_name} onChange={e => update('full_name', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium">Location</Label>
              <Input className="mt-1" value={form.location} onChange={e => update('location', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-medium">Residential Address</Label>
              <Input className="mt-1" value={form.residential_address} onChange={e => update('residential_address', e.target.value)} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </Card>

          {/* Profile visibility toggle — only shown once the admin has enabled
              this feature. Kept hidden by default so a small early user base
              can't collectively go incognito and make the app look empty. */}
          {profileVisibilityFeatureEnabled && (
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {profileVisible ? <Eye className="w-5 h-5 text-primary shrink-0" /> : <EyeOff className="w-5 h-5 text-muted-foreground shrink-0" />}
                  <div>
                    <p className="text-sm font-semibold text-foreground">Profile Visibility</p>
                    <p className="text-xs text-muted-foreground">
                      {profileVisible ? 'Your profile is visible in search results' : 'Your profile is hidden from search results'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleToggleProfileVisible}
                  disabled={visibilityUpdating}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${profileVisible ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${profileVisible ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="verification" className="space-y-5">
          {/* ID Verification */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <p className="text-sm font-semibold">ID Document</p>
              </div>
              {renderVerificationStatus(idSubmission, user?.id_verified)}
            </div>
            {!user?.id_verified && (
              <>
                <label className="flex items-center gap-2 border border-dashed border-border rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-colors mb-2">
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => setIdFile(e.target.files[0] || null)} />
                  <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">{idFile ? idFile.name : 'Tap to choose your ID document'}</span>
                </label>
                <Button size="sm" className="w-full gap-2" disabled={submittingId || !idFile} onClick={handleIdSubmit}>
                  {submittingId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {submittingId ? 'Submitting…' : 'Submit for Verification'}
                </Button>
              </>
            )}
          </Card>

          {/* Licence Verification */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 text-primary" />
                <p className="text-sm font-semibold">Driver's Licence</p>
              </div>
              {renderVerificationStatus(licenceSubmission, user?.licence_verified)}
            </div>
            {!user?.licence_verified && (
              <>
                <label className="flex items-center gap-2 border border-dashed border-border rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-colors mb-2">
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => setLicenceFile(e.target.files[0] || null)} />
                  <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">{licenceFile ? licenceFile.name : 'Tap to choose your licence document'}</span>
                </label>
                <Button size="sm" className="w-full gap-2" disabled={submittingLicence || !licenceFile} onClick={handleLicenceSubmit}>
                  {submittingLicence ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {submittingLicence ? 'Submitting…' : 'Submit for Verification'}
                </Button>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
