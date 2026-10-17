// src/pages/admin/AdminGigSettings.jsx
//
// Admin page for gig money settings: Skootlink's commission on completed gigs
// and the fare rates used for estimates (min fare covers the first 2 km,
// then a per-km rate on straight-line distance — see create-gig-request.js).
// Route: /admin/gig-settings. Reads/writes via admin-app-settings
// (get_gig_pricing / update_gig_pricing).

import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const FIELDS = [
  { key: 'commission_percent', column: 'gig_commission_percent', label: 'Commission (% of fare)', step: '0.5' },
  { key: 'ride_minimum_fare', column: 'ride_minimum_fare', label: 'Ride: minimum fare (R, covers first 2 km)', step: '0.5' },
  { key: 'ride_per_km_rate', column: 'ride_per_km_rate', label: 'Ride: per km after 2 km (R)', step: '0.1' },
  { key: 'delivery_minimum_fare', column: 'delivery_minimum_fare', label: 'Delivery: minimum fare (R, covers first 2 km)', step: '0.5' },
  { key: 'delivery_per_km_rate', column: 'delivery_per_km_rate', label: 'Delivery: per km after 2 km (R)', step: '0.1' },
  { key: 'cancellation_fee', column: 'gig_cancellation_fee', label: 'Cancellation / no-show fee (R)', step: '0.5' },
  { key: 'cancel_grace_minutes', column: 'gig_cancel_grace_minutes', label: 'Free cancellation after a driver accepts (minutes)', step: '1', integer: true },
  { key: 'no_show_wait_minutes', column: 'gig_no_show_wait_minutes', label: 'Driver waits before marking a no-show (minutes)', step: '1', integer: true },
];

async function callSettings(payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const res = await fetch('/.netlify/functions/admin-app-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export default function AdminGigSettings() {
  const [inputs, setInputs] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await callSettings({ action: 'get_gig_pricing' });
      const next = {};
      for (const f of FIELDS) next[f.key] = data[f.column] != null ? String(data[f.column]) : '';
      setInputs(next);
    } catch (err) {
      console.error('[AdminGigSettings] load failed:', err);
      toast.error('Could not load gig settings: ' + err.message);
      setInputs({});
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const payload = { action: 'update_gig_pricing' };
    for (const f of FIELDS) {
      const n = parseFloat(inputs[f.key]);
      if (!Number.isFinite(n)) {
        toast.error(`${f.label} must be a number`);
        return;
      }
      if (f.integer && !Number.isInteger(n)) {
        toast.error(`${f.label} must be a whole number`);
        return;
      }
      payload[f.key] = n;
    }
    setSaving(true);
    try {
      await callSettings(payload);
      toast.success('Gig settings saved ✓');
    } catch (err) {
      console.error('[AdminGigSettings] save failed:', err);
      toast.error('Could not save: ' + err.message);
    }
    setSaving(false);
  };

  if (!inputs) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h2 className="text-2xl font-bold">Gig Settings</h2>
        <p className="text-sm text-muted-foreground">
          Commission, fare rates and cancellation rules. Fare changes apply to new gigs; cancellation rules apply immediately.
          A customer who cancels after the free period, or after the driver has arrived, pays the fee; so does a no-show.
          The driver earns the fee minus commission.
        </p>
      </div>

      <div className="rounded-xl border border-border p-4 space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              type="number"
              inputMode="decimal"
              step={f.step}
              min="0"
              value={inputs[f.key] ?? ''}
              onChange={(e) => setInputs((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <Button onClick={save} disabled={saving} className="w-full">
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
