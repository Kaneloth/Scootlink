import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '@/api/supabaseData';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { ImagePlus, X, Trash2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';
import { geocodeLocation } from '@/lib/geocode';
import InsufficientCreditsModal from '@/components/credits/InsufficientCreditsModal';

export default function AddVehicle() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [searchParams] = useSearchParams();
  const editingId  = searchParams.get('id');
  const isRelist   = searchParams.get('relist') === '1';
  const isEditMode = !!editingId;
  const [loadingExisting, setLoadingExisting] = useState(isEditMode);
  const [listingPrice, setListingPrice] = useState(null);
  const [showTopUpPrompt, setShowTopUpPrompt] = useState(false);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  // Fetch the tiered listing price for new vehicles (not relevant when editing)
  useEffect(() => {
    if (isEditMode) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.rpc('get_listing_price', { p_owner_id: user.id });
      setListingPrice(data ?? 250);
    })();
  }, [isEditMode]);

  const [form, setForm] = useState({
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
    status:                 'available',
  });
  const [images,    setImages]    = useState([]);
  const [uploading, setUploading] = useState(false);

  // Prefill form when editing/relisting an existing vehicle
  useEffect(() => {
    if (!editingId) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', editingId)
          .single();
        if (error) throw error;
        setForm({
          vehicle_type:           data.type || 'scooter',
          make:                   data.make || '',
          model:                  data.model || '',
          year:                   data.year ? String(data.year) : '',
          color:                  data.color || '',
          transmission:           data.transmission || '',
          plate:                  data.plate || '',
          location:               data.location || '',
          price_per_week:         data.price ? String(data.price) : '',
          deposit:                data.deposit ? String(data.deposit) : '',
          storage_type:           data.storage_type || 'owner_address',
          pickup_return_location: data.pickup_return_location || '',
          status:                 data.status || 'available',
        });
        setImages(data.images || []);
      } catch (err) {
        toast.error('Could not load vehicle details: ' + err.message);
      } finally {
        setLoadingExisting(false);
      }
    })();
  }, [editingId]);

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
            dbRow.geo_location = `SRID=4326;POINT(${coords.longitude} ${coords.latitude})`;
          }
        } catch { /* non-fatal — vehicle still lists without coordinates */ }
      }

      // ── Editing or relisting an existing vehicle ──────────────────────────
      if (editingId) {
        const { data: result, error } = await supabase
          .from('vehicles')
          .update(dbRow)
          .eq('id', editingId)
          .eq('owner_id', user.id)
          .select()
          .single();
        if (error) throw new Error(error.message);

        // Relist = pay credits and reset the 6-month expiry clock
        if (isRelist) {
          // Count OTHER active vehicles (excluding this one) to determine tier:
          // 0 others = 250cr (1st vehicle), 1 other = 200cr (2nd), 2+ others = 175cr (3rd+)
          const { data: otherVehicles } = await supabase
            .from('vehicles')
            .select('id', { count: 'exact' })
            .eq('owner_id', user.id)
            .neq('id', editingId);
          const otherCount = otherVehicles?.length ?? 0;
          const relistCost = otherCount === 0 ? 250 : otherCount === 1 ? 200 : 175;

          const { error: deductErr } = await supabase.rpc('deduct_credits', {
            p_user_id:     user.id,
            p_amount:      relistCost,
            p_type:        'spend',
            p_description: 'Vehicle relisting',
            p_ref_id:      String(editingId),
          });
          if (deductErr) {
            if (deductErr.message?.includes('insufficient_credits')) throw new Error('insufficient_credits');
            throw new Error(deductErr.message || 'Could not charge relisting fee');
          }

          // Reset the expiry clock directly
          await supabase.from('vehicles').update({
            listed_at:        new Date().toISOString(),
            expires_at:       new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString(),
            grace_expires_at: null,
            listing_state:    'active',
            reminder_7d_sent: false,
            reminder_3d_sent: false,
            reminder_1d_sent: false,
          }).eq('id', editingId);
        }
        return result;
      }

      // ── Creating a brand new listing ───────────────────────────────────────
      // Check credits BEFORE inserting to avoid orphan rows if payment fails.
      // get_listing_price tells us the tier cost without charging yet.
      const { data: tierPrice } = await supabase.rpc('get_listing_price', { p_owner_id: user.id });
      const creditCost = tierPrice ?? 250;

      // Check balance
      const { data: balance } = await supabase.rpc('get_credit_balance', { p_user_id: user.id });
      if ((balance ?? 0) < creditCost) {
        throw new Error('insufficient_credits');
      }

      const { data: result, error } = await supabase
        .from('vehicles')
        .insert(dbRow)
        .select('*')
        .single();
      if (error) throw new Error(error.message);

      // Charge tiered listing fee directly using the already-calculated creditCost
      const { error: deductErr } = await supabase.rpc('deduct_credits', {
        p_user_id:    user.id,
        p_amount:     creditCost,
        p_type:       'spend',
        p_description: 'Vehicle listing',
        p_ref_id:     String(result.id),
      });
      if (deductErr) {
        await supabase.from('vehicles').delete().eq('id', result.id);
        if (deductErr.message?.includes('insufficient_credits')) {
          throw new Error('insufficient_credits');
        }
        throw new Error(deductErr.message || 'Could not charge listing fee');
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      toast.success(
        isRelist ? 'Vehicle re-listed! Your listing is active for another 6 months.' :
        isEditMode ? 'Vehicle details updated!' :
        'Vehicle listed successfully!'
      );
      navigate(isEditMode ? '/briefcase' : '/home');
    },
    onError: (err) => {
      console.error('Vehicle save error:', err);
      if (err?.message === 'insufficient_credits') {
        setShowTopUpPrompt(true);
        return;
      }
      toast.error('Failed to save vehicle: ' + (err?.message || 'Unknown error'));
    },
  });

  // Converts a public Storage URL back into the raw path .remove() needs,
  // e.g. "https://<project>.supabase.co/storage/v1/object/public/vehicle-images/<user_id>/<file>"
  // → "<user_id>/<file>". Returns null if the URL doesn't match this bucket's
  // shape, so a malformed/unexpected entry is skipped rather than passed
  // through and rejected by the API.
  function extractVehicleImagePath(publicUrl) {
    const marker = '/vehicle-images/';
    const idx = publicUrl?.indexOf(marker);
    if (idx == null || idx === -1) return null;
    return publicUrl.slice(idx + marker.length);
  }

  // Used when a full delete is blocked by rental history (see deleteMutation
  // below) — removes the actual image files from Storage to free up space,
  // and clears vehicles.images to []. That second part matters: without it,
  // the row would still list URLs pointing at files that no longer exist,
  // and every card showing this vehicle would render a broken image instead
  // of just having none.
  const deleteImagesMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const paths = images.map(extractVehicleImagePath).filter(Boolean);
      if (paths.length > 0) {
        const { error: storageErr } = await supabase.storage.from('vehicle-images').remove(paths);
        if (storageErr) throw storageErr;
      }
      const { error: dbErr } = await supabase
        .from('vehicles')
        .update({ images: [] })
        .eq('id', editingId)
        .eq('owner_id', user.id);
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      setImages([]);
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicle', editingId] });
      toast.success('Photos removed to free up storage space. The listing itself remains, since it still has rental history.');
    },
    onError: (err) => {
      console.error('Image cleanup error:', err);
      toast.error('Failed to remove photos: ' + (err?.message || 'Unknown error'));
    },
  });

  // Permanent hard delete — the vehicle row itself is removed, not just
  // hidden/marked inactive. If it has any rental history (past or active),
  // the vehicles→rentals foreign key will block this at the database level;
  // surfaced here as a clear message rather than a generic error, since a
  // silent/unclear failure here would look exactly like "nothing happened"
  // to the owner.
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', editingId)
        .eq('owner_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      toast.success('Vehicle deleted.');
      navigate('/briefcase');
    },
    onError: (err) => {
      console.error('Vehicle delete error:', err);
      const isRentalHistoryBlock = err?.code === '23503' || /foreign key/i.test(err?.message || '');
      if (!isRentalHistoryBlock) {
        toast.error('Failed to delete: ' + (err?.message || 'Unknown error'));
        return;
      }
      toast.error('This vehicle can\'t be deleted because it has rental history attached to it. Set its status to Maintenance instead to hide it from search.');
      // Deliberately a separate, explicit confirmation rather than an
      // automatic side effect of the failed delete — this listing may
      // still be live, and silently stripping its photos without the
      // owner asking for that specifically would be a bad surprise.
      if (images.length > 0 && window.confirm('The listing itself will stay (it has rental history), but would you like to remove its photos now to free up storage space?')) {
        deleteImagesMutation.mutate();
      }
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
    const payload = {
      ...form,
      year:           parseInt(form.year) || 2024,
      price_per_week: parseFloat(form.price_per_week),
      deposit:        parseFloat(form.deposit) || 0,
      images,
      rating:         0,
      total_reviews:  0,
    };
    // Only set status to 'available' for brand new listings —
    // editing/relisting must not override 'rented' or other states
    if (!isEditMode) payload.status = 'available';
    mutation.mutate(payload);
  };

  const update = (field, value) => setForm(prev => {
    const next = { ...prev, [field]: value };
    if (field === 'vehicle_type' && value === 'bicycle') next.transmission = '';
    return next;
  });

  if (loadingExisting) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title={isRelist ? 'Re-list Vehicle' : 'Edit Vehicle'} backTo="/briefcase" />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <InsufficientCreditsModal
        open={showTopUpPrompt}
        onClose={() => setShowTopUpPrompt(false)}
        requiredAmount={listingPrice}
        actionLabel={isRelist ? 're-list this vehicle' : 'list this vehicle'}
      />
      <PageHeader
        title={isRelist ? 'Re-list Vehicle' : isEditMode ? 'Edit Vehicle' : 'Add Vehicle'}
        subtitle={isRelist ? 'Confirm or update details, then re-list for another 6 months' : isEditMode ? 'Update your vehicle details' : 'List your vehicle for drivers to rent'}
        backTo={isEditMode ? '/briefcase' : '/home'}
      />
      {isRelist && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            🔄 Re-listing resets your listing's 6-month expiry from today.
          </p>
        </div>
      )}
      <Card className="p-6 border border-border/50">
        <div className="space-y-4">
          <div>
            <Label>Vehicle Type</Label>
            <Select value={form.vehicle_type} onValueChange={v => update('vehicle_type', v)}>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Color</Label>
              <Input className="mt-1" placeholder="White" value={form.color} onChange={e => update('color', e.target.value)} />
            </div>
            {form.vehicle_type !== 'bicycle' && (
              <div>
                <Label>Transmission</Label>
                <Select value={form.transmission} onValueChange={v => update('transmission', v)}>
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
          {isEditMode && (
            <div>
              <Label>Listing Status</Label>
              <p className="text-[10px] text-muted-foreground mb-1">
                Set to Maintenance to temporarily hide this listing from search without deleting it — you can switch it back to Available anytime.
              </p>
              <Select value={form.status} onValueChange={v => update('status', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">✅ Available</SelectItem>
                  <SelectItem value="maintenance">🔧 Maintenance (hidden from search)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
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
          <div className="flex gap-3 mt-2">
            <Button onClick={handleSubmit} className="flex-1" disabled={mutation.isPending || deleteMutation.isPending || deleteImagesMutation.isPending}>
              {mutation.isPending
                ? (isRelist ? 'Re-listing…' : isEditMode ? 'Saving…' : 'Listing…')
                : (isRelist ? 'Re-list Vehicle' : isEditMode ? 'Save Changes' : 'List Vehicle')}
            </Button>
            {isEditMode && (
              <Button
                variant="destructive"
                size="icon"
                disabled={mutation.isPending || deleteMutation.isPending || deleteImagesMutation.isPending}
                onClick={() => {
                  if (window.confirm('Permanently delete this vehicle? This cannot be undone — you\'ll need to re-add it from scratch if you change your mind.')) {
                    deleteMutation.mutate();
                  }
                }}
              >
                {(deleteMutation.isPending || deleteImagesMutation.isPending)
                  ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Trash2 className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
