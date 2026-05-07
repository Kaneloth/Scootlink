import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Vehicle } from '@/api/supabaseData';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { ImagePlus, X, Trash2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';

export default function EditVehicle() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const vehicleId = searchParams.get('id');
  const queryClient = useQueryClient();

  const [form, setForm] = useState(null);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => Vehicle.get(vehicleId),
    enabled: !!vehicleId,
  });

  useEffect(() => {
    if (vehicle) {
      setForm({
        vehicle_type: vehicle.vehicle_type || 'scooter',
        make: vehicle.make || '',
        model: vehicle.model || '',
        year: vehicle.year || '',
        plate: vehicle.plate || '',
        location: vehicle.location || '',
        price_per_week: vehicle.price_per_week || '',
        deposit: vehicle.deposit || '',
        status: vehicle.status || 'available',
      });
      setImages(vehicle.images || []);
    }
  }, [vehicle]);

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const dbRow = { ...data };
      if ('vehicle_type' in dbRow) { dbRow.type = dbRow.vehicle_type; delete dbRow.vehicle_type; }
      if ('price_per_week' in dbRow) { dbRow.price = dbRow.price_per_week; delete dbRow.price_per_week; }
      const { data: result, error } = await supabase
        .from('vehicles')
        .update(dbRow)
        .eq('id', vehicleId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      toast.success('Vehicle updated!');
      navigate('/');
    },
    onError: (err) => toast.error('Failed to update: ' + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => Vehicle.delete(vehicleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      toast.success('Vehicle deleted');
      navigate('/');
    },
    onError: (err) => toast.error('Failed to delete: ' + err.message),
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
    updateMutation.mutate({
      ...form,
      year: parseInt(form.year) || 2024,
      price_per_week: parseFloat(form.price_per_week),
      deposit: parseFloat(form.deposit) || 0,
      images,
    });
  };

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  if (isLoading || !form) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Edit Vehicle" subtitle="Update your vehicle listing" backTo="/" />
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
              <Input className="mt-1" value={form.make} onChange={e => update('make', e.target.value)} />
            </div>
            <div>
              <Label>Model *</Label>
              <Input className="mt-1" value={form.model} onChange={e => update('model', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Year</Label>
              <Input className="mt-1" type="number" value={form.year} onChange={e => update('year', e.target.value)} />
            </div>
            <div>
              <Label>License Plate *</Label>
              <Input className="mt-1" value={form.plate} onChange={e => update('plate', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Location *</Label>
            <Input className="mt-1" value={form.location} onChange={e => update('location', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Weekly Price (ZAR) *</Label>
              <Input className="mt-1" type="number" value={form.price_per_week} onChange={e => update('price_per_week', e.target.value)} />
            </div>
            <div>
              <Label>Deposit (ZAR)</Label>
              <Input className="mt-1" type="number" value={form.deposit} onChange={e => update('deposit', e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => update('status', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="rented">Rented</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
              </SelectContent>
            </Select>
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

          <div className="flex gap-3 pt-2">
            <Button onClick={handleSubmit} className="flex-1" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => { if (confirm('Delete this vehicle?')) deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}