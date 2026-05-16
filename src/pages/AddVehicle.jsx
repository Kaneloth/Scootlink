import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '@/api/supabaseData';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { ImagePlus, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import SubscriptionGate from '@/components/subscription/SubscriptionGate';
import { toast } from 'sonner';
import { geocodeLocation } from '@/lib/geocode';

export default function AddVehicle() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const [form, setForm] = useState({
    vehicle_type:           'scooter',
    make:                   '',
    model:                  '',
    year:                   '',
    plate:                  '',
    location:               '',
    price_per_week:         '',
    deposit:                '',
    storage_type:           'owner_address',
    pickup_return_location: '',
  });

  const [images,    setImages]    = useState([]);
  const [uploading, setUploading] = useState(false);

  const mutation = useMutation({
    mutationFn: async (data) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Map frontend field names → DB column names
      const dbRow = { ...data };
      if ('vehicle_type'   in dbRow) { dbRow.type  = dbRow.vehicle_type;   delete dbRow.vehicle_type;   }
      if ('price_per_week' in dbRow) { dbRow.price = dbRow.price_per_week; delete dbRow.price_per_week; }
      dbRow.owner_id = user.id;

      // Geocode the location and store a PostGIS geography point (non-fatal)
      if (dbRow.location) {
        try {
          const coords = await geocodeLocation(dbRow.location);
          if (coords) {
            dbRow.latitude     = coords.latitude;
            dbRow.longitude    = coords.longitude;
            dbRow.geo_location = `SRID=4326;POINT(${coords.longitude} ${coords.latitude})`;
          }
        } catch { /* non-fatal — vehicle still lists without coordinates */ }
      }

      const { data: result, error } = await supabase
        .from('vehicles')
        .insert(dbRow)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      toast.success('Vehicle listed successfully!');
      navigate('/');
    },
    onError: (err) => {
      console.error('Vehicle create error:', err);
      toast.error('Failed to list vehicle: ' + (err?.message || 'Unknown error'));
    },
  });

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files).slice(0, 3 - images.length);
    if (!files.length) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const urls = [];
      for (const file of files) {
        const filePath = `${user.id}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('vehicle-images').upload(filePath, file, { upsert: true, contentType: file.type });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('vehicle-images').getPublicUrl(filePath);
        urls.push(publicUrl);
      }
      setImages(prev => [...prev, ...urls]);
    } catch (err) {
      toast.error('Image upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!form.make || !form.model || !form.plate || !form.location || !form.price_per_week) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (form.storage_type === 'owner_address' && !form.pickup_return_location) {
      toast.error('Please specify the pickup/return address');
      return;
    }
    mutation.mutate({
      ...form,
      year:           parseInt(form.year) || 2024,
      price_per_week: parseFloat(form.price_per_week),
      deposit:        parseFloat(form.deposit) || 0,
      status:         'available',
      images,
      rating:         0,
      total_reviews:  0,
    });
  };

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Add Vehicle" subtitle="List your vehicle for drivers to rent" backTo="/" />
      <Card className="p-6 border border-border/50">
        <div className="space-y-4">
          <div>
            <Label>Vehicle Type</Label>
            <Select value={form.vehicle_type} onValueChange={v => update('vehicle_type', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scooter">🛵 Scooter</SelectItem>
                <SelectItem value="motorcycle">🏍️ Motorcycle</SelectItem>
                <SelectItem value="car">🚗 Car</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Make *</Label>
              <Input className="mt-1" placeholder="Honda" value={form.make} onChange={e => update('make', e.target.value)} />
            </div>
            <div>
              <Label>Model *</Label>
              <Input className="mt-1" placeholder="PCX 150" value={form.model} onChange={e => update('model', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Year</Label>
              <Input className="mt-1" type="number" placeholder="2024" value={form.year} onChange={e => update('year', e.target.value)} />
            </div>
            <div>
              <Label>License Plate *</Label>
              <Input className="mt-1" placeholder="ABC 123 GP" value={form.plate} onChange={e => update('plate', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Location *</Label>
            <Input className="mt-1" placeholder="Johannesburg CBD" value={form.location} onChange={e => update('location', e.target.value)} />
            <p className="text-[11px] text-muted-foreground mt-1">This will be geocoded so drivers can find you in proximity searches.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Storage Type</Label>
              <Select value={form.storage_type} onValueChange={v => update('storage_type', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_address">Owner's Address</SelectItem>
                  <SelectItem value="driver_responsibility">Driver's Responsibility</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pickup/Return Address</Label>
              <Input
                className="mt-1"
                placeholder="123 Main St, Johannesburg"
                value={form.pickup_return_location}
                onChange={e => update('pickup_return_location', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Weekly Price (ZAR) *</Label>
              <Input className="mt-1" type="number" placeholder="500" value={form.price_per_week} onChange={e => update('price_per_week', e.target.value)} />
            </div>
            <div>
              <Label>Deposit (ZAR)</Label>
              <Input className="mt-1" type="number" placeholder="1000" value={form.deposit} onChange={e => update('deposit', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Photos (up to 3)</Label>
            <div className="mt-2 flex gap-3 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden group">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ))}
              {images.length < 3 && (
                <label className="w-20 h-20 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                  {uploading ? (
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <ImagePlus className="w-5 h-5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground mt-1">Add</span>
                    </>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              )}
            </div>
          </div>

          <Button onClick={handleSubmit} className="w-full mt-2" disabled={mutation.isPending}>
            {mutation.isPending ? 'Listing...' : 'List Vehicle'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
