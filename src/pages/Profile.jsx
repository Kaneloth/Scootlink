import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldCheck, Loader2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import StarRating from '@/components/reviews/StarRating';
import ReviewsSection from '@/components/reviews/ReviewsSection';
import { toast } from 'sonner';

// ─── Skeleton components ──────────────────────────────────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);

  // Non-sensitive fields stored in user metadata
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    gender: '',
    location: '',
    residential_address: '',
    license_number: '',
    license_year: '',
    citizenship: 'South African',
  });

  // Sensitive fields — loaded from the separate user_sensitive_info table
  const [sensitiveForm, setSensitiveForm] = useState({
    sa_id: '',
    passport: '',
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    auth.me()
      .then(async (u) => {
        if (cancelled) return;
        setUser(u);
        setForm({
          full_name: u.full_name || '',
          email: u.email || '',
          phone: u.phone || '',
          gender: u.gender || '',
          location: u.location || '',
          residential_address: u.residential_address || '',
          license_number: u.license_number || '',
          license_year: u.license_year ? String(u.license_year) : '',
          citizenship: u.citizenship || 'South African',
        });

        // Load sensitive fields from the isolated RLS-protected table
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
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setUserLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // ── 1. Update non-sensitive user metadata ──────────────────────────────
      const metadataUpdates = {
        full_name: form.full_name,
        phone: form.phone,
        gender: form.gender,
        location: form.location,
        residential_address: form.residential_address,
        license_number: form.license_number,
        license_year: form.license_year ? parseInt(form.license_year) : null,
        citizenship: form.citizenship,
      };

      await auth.updateMe(metadataUpdates);

      // ── 2. Upsert sensitive fields in the isolated table ───────────────────
      // RLS ensures only this user's row can be written.
      const { error: sensitiveError } = await supabase
        .from('user_sensitive_info')
        .upsert(
          {
            user_id: user.id,
            sa_id: sensitiveForm.sa_id || null,
            passport: sensitiveForm.passport || null,
          },
          { onConflict: 'user_id' }
        );

      if (sensitiveError) throw sensitiveError;

      // ── 3. Handle email change separately (requires confirmation) ──────────
      if (form.email !== user.email) {
        const { error } = await supabase.auth.updateUser({ email: form.email });
        if (error) throw error;
        toast.success('Confirmation email sent to ' + form.email + '. Please verify to complete the change.');
      }

      toast.success('Profile updated!');
      navigate('/settings');
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
      <PageHeader title="My Profile" subtitle="Edit details & view your reviews" backTo="/settings" />

      {/* Profile header */}
      {userLoading ? (
        <ProfileHeaderSkeleton />
      ) : user ? (
        <Card className="p-5 mb-4 border border-border/50">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary overflow-hidden shrink-0">
              {user.selfie_url ? (
                <img src={user.selfie_url} alt="" className="w-full h-full object-cover" />
              ) : (
                user.full_name?.[0] || 'U'
              )}
            </div>
            <div>
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
            </div>
          </div>
        </Card>
      ) : null}

      <Tabs defaultValue="edit">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="edit">Edit Info</TabsTrigger>
          <TabsTrigger value="reviews-received">My Reviews</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          {userLoading ? (
            <FormSkeleton />
          ) : (
            <Card className="p-6 border border-border/50">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Full Name</Label>
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
                  <div>
                    <Label>Phone</Label>
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
                </div>

                <div>
                  <Label>Location</Label>
                  <Input
                    className="mt-1"
                    placeholder="Johannesburg CBD"
                    value={form.location}
                    onChange={(e) => update('location', e.target.value)}
                  />
                </div>

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
                  <Label>Citizenship</Label>
                  <Select value={form.citizenship} onValueChange={(v) => update('citizenship', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="South African">South African</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Sensitive identity fields — saved to a separate RLS-protected table */}
                {form.citizenship === 'South African' ? (
                  <div>
                    <Label>SA ID Number</Label>
                    <Input
                      className="mt-1"
                      placeholder="13-digit ID"
                      value={sensitiveForm.sa_id}
                      onChange={(e) => updateSensitive('sa_id', e.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <Label>Passport Number</Label>
                    <Input
                      className="mt-1"
                      placeholder="Passport number"
                      value={sensitiveForm.passport}
                      onChange={(e) => updateSensitive('passport', e.target.value)}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>License Number</Label>
                    <Input
                      className="mt-1"
                      placeholder="DL123"
                      value={form.license_number}
                      onChange={(e) => update('license_number', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>License Year</Label>
                    <Input
                      className="mt-1"
                      type="number"
                      placeholder="2018"
                      value={form.license_year}
                      onChange={(e) => update('license_year', e.target.value)}
                    />
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

        <TabsContent value="reviews-received">
          <ReviewsSection targetEmail={user?.email} targetType="owner" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
