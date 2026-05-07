import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '@/api/supabaseData';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import StarRating from '@/components/reviews/StarRating';
import ReviewsSection from '@/components/reviews/ReviewsSection';
import { toast } from 'sonner';

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({
    phone: '', gender: '', location: '', residential_address: '',
    account_type: 'driver', license_number: '', license_year: '',
    citizenship: 'South African', sa_id: '', passport: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      setForm({
        phone: u.phone || '', gender: u.gender || '', location: u.location || '',
        residential_address: u.residential_address || '', account_type: u.account_type || 'driver',
        license_number: u.license_number || '', license_year: u.license_year || '',
        citizenship: u.citizenship || 'South African', sa_id: u.sa_id || '', passport: u.passport || '',
      });
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await auth.updateMe({ ...form, license_year: form.license_year ? parseInt(form.license_year) : undefined });
    toast.success('Profile updated!');
    setSaving(false);
    navigate('/settings');
  };

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="My Profile" subtitle="Edit details & view your reviews" backTo="/settings" />

      {/* Profile header with rating */}
      {user && (
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
                {(user.total_reviews > 0) && (
                  <span className="text-xs text-muted-foreground">({user.total_reviews} reviews)</span>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue="edit">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="edit">Edit Info</TabsTrigger>
          <TabsTrigger value="reviews-received">My Reviews</TabsTrigger>
          <TabsTrigger value="reviews-driver">As Driver</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <Card className="p-6 border border-border/50">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Full Name</Label>
                  <Input className="mt-1" value={user?.full_name || ''} disabled />
                  <p className="text-[10px] text-muted-foreground mt-1">Managed by your login account</p>
                </div>
                <div className="col-span-2">
                  <Label>Email</Label>
                  <Input className="mt-1" value={user?.email || ''} disabled />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Phone</Label>
                  <Input className="mt-1" placeholder="+27 123 456 789" value={form.phone} onChange={e => update('phone', e.target.value)} />
                </div>
                <div>
                  <Label>Gender</Label>
                  <Select value={form.gender} onValueChange={v => update('gender', v)}>
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
                <Label>Account Type</Label>
                <Select value={form.account_type} onValueChange={v => update('account_type', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Vehicle Owner</SelectItem>
                    <SelectItem value="driver">Driver</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Location</Label>
                <Input className="mt-1" placeholder="Johannesburg CBD" value={form.location} onChange={e => update('location', e.target.value)} />
              </div>

              <div>
                <Label>Residential Address</Label>
                <Input className="mt-1" placeholder="123 Main St, Johannesburg" value={form.residential_address} onChange={e => update('residential_address', e.target.value)} />
              </div>

              <div>
                <Label>Citizenship</Label>
                <Select value={form.citizenship} onValueChange={v => update('citizenship', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="South African">South African</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.citizenship === 'South African' ? (
                <div>
                  <Label>SA ID Number</Label>
                  <Input className="mt-1" placeholder="13-digit ID" value={form.sa_id} onChange={e => update('sa_id', e.target.value)} />
                </div>
              ) : (
                <div>
                  <Label>Passport Number</Label>
                  <Input className="mt-1" placeholder="Passport number" value={form.passport} onChange={e => update('passport', e.target.value)} />
                </div>
              )}

              {(form.account_type === 'driver' || form.account_type === 'both') && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>License Number</Label>
                    <Input className="mt-1" placeholder="DL123" value={form.license_number} onChange={e => update('license_number', e.target.value)} />
                  </div>
                  <div>
                    <Label>License Year</Label>
                    <Input className="mt-1" type="number" placeholder="2018" value={form.license_year} onChange={e => update('license_year', e.target.value)} />
                  </div>
                </div>
              )}

              <Button onClick={handleSave} className="w-full" disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="reviews-received">
          <ReviewsSection targetEmail={user?.email} targetType="owner" />
        </TabsContent>

        <TabsContent value="reviews-driver">
          <ReviewsSection targetEmail={user?.email} targetType="driver" />
        </TabsContent>
      </Tabs>
    </div>
  );
}