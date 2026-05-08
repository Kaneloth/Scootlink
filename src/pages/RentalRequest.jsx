import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, Vehicle } from '@/api/supabaseData';
import { supabase } from '@/api/supabaseClient';   // or from '@/api/supabaseData' if exported
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Send, AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import VehicleCard from '@/components/vehicles/VehicleCard';
import SubscriptionGate from '@/components/subscription/SubscriptionGate';
import { toast } from 'sonner';

export default function RentalRequest() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const vehicleId = urlParams.get('vehicleId');

  const [user, setUser] = useState(null);
  const [form, setForm] = useState({
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    message: '',
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['all-vehicles'],
    queryFn: () => Vehicle.list(),
  });

  const vehicle = vehicles.find(v => String(v.id) === vehicleId);

  const estimate = useMemo(() => {
    if (!vehicle || !form.start_date || !form.end_date) return null;
    const days = Math.max(1, Math.ceil((new Date(form.end_date) - new Date(form.start_date)) / (1000 * 60 * 60 * 24)));
    const weeks = Math.ceil(days / 7);
    return { weeks, total: weeks * vehicle.price_per_week, deposit: vehicle.deposit || 0 };
  }, [vehicle, form.start_date, form.end_date]);

  const handleSubmit = async () => {
    if (!vehicle || !user) return;

    setSending(true);
    setError(null);

    try {
      const { error: insertError } = await supabase
        .from('rentals')
        .insert([{
          vehicle_id: vehicle.id,
          driver_id: user.id,             // logged‑in user
          owner_id: vehicle.owner_id,     // vehicle's owner
          start_date: form.start_date,
          end_date: form.end_date,
          status: 'pending',
          price_per_week: vehicle.price_per_week,
          deposit: vehicle.deposit || 0,
          message: form.message,
        }]);

      if (insertError) throw insertError;

      toast.success('Proposal sent to the owner!');
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      navigate('/');
    } catch (err) {
      console.error('Rental insert error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title="Rental Request" backTo="/search-vehicles" />
        <p className="text-muted-foreground">Loading vehicle…</p>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title="Rental Request" backTo="/search-vehicles" />
        <p className="text-muted-foreground">Vehicle not found.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Propose Rental" subtitle="Send a rental request to the owner" backTo="/search-vehicles" />
      <SubscriptionGate user={user} loading={user === null}>

        <VehicleCard vehicle={vehicle} showPrice={true} />

        <Card className="p-6 border border-border/50 mt-4">
          <div className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Date</Label>
                <Input className="mt-1" type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div>
                <Label>End Date</Label>
                <Input className="mt-1" type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label>Message to Owner</Label>
              <Textarea
                className="mt-1"
                placeholder="Tell the owner about yourself, delivery platforms you work with..."
                value={form.message}
                onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                rows={3}
              />
            </div>

            {estimate && (
              <div className="bg-muted rounded-xl p-4">
                <h4 className="font-semibold text-sm mb-2">Estimated Total</h4>
                <p className="text-sm text-muted-foreground">
                  {estimate.weeks} week{estimate.weeks !== 1 ? 's' : ''} × R {vehicle.price_per_week} = <span className="font-bold text-foreground">R {estimate.total}</span>
                </p>
                {estimate.deposit > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">+ R {estimate.deposit} security deposit</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">Final price will be agreed in the contract</p>
              </div>
            )}

            <Button onClick={handleSubmit} className="w-full gap-2" disabled={sending}>
              <Send className="w-4 h-4" />
              {sending ? 'Sending...' : 'Send Proposal'}
            </Button>
          </div>
        </Card>
      </SubscriptionGate>
    </div>
  );
}
