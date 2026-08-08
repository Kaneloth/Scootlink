// src/pages/VehicleRideReadySubmit.jsx
//
// destination: src/pages/VehicleRideReadySubmit.jsx
//
// Owner-facing Ride-Ready submission for ONE vehicle. Standalone page
// rather than injected into AddVehicle.jsx — see chat note on why
// (560-line file only partially seen, didn't want to edit it blind).
//
// Route needs a vehicleId param, e.g. /vehicle-ride-ready/:vehicleId,
// reached from wherever you list an owner's vehicles (MyBriefcase or
// similar — I don't have that file, so no "Get Ride-Ready" link is
// wired up anywhere yet. That's a small addition once you pick where
// it should live in the UI).

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { compressImage } from '@/lib/imageCompress';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Loader2, CheckCircle2, Clock, XCircle, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';

export default function VehicleRideReadySubmit() {
  const { vehicleId } = useParams();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [certFile, setCertFile] = useState(null);
  const [expiryDate, setExpiryDate] = useState('');
  const [testingStation, setTestingStation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await auth.me();
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, plate, owner_id, ride_ready_status, roadworthy_expiry_date, roadworthy_testing_station, ride_ready_rejection_reason')
        .eq('id', vehicleId)
        .maybeSingle();

      if (error || !data || data.owner_id !== user?.id) {
        toast.error('Vehicle not found');
        navigate('/briefcase');
        return;
      }
      setVehicle(data);
      setLoading(false);
    })();
  }, [vehicleId, navigate]);

  const canSubmit = certFile && expiryDate && testingStation.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const certBase64 = await compressImage(certFile);
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch('/.netlify/functions/submit-vehicle-ride-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          vehicleId,
          certificateImageBase64: certBase64,
          expiryDate,
          testingStation: testingStation.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      toast.success(data.alreadyPending ? data.message : 'Submitted! We\'ll review your certificate shortly.');
      setVehicle((prev) => ({ ...prev, ride_ready_status: 'pending' }));
      setCertFile(null);
    } catch (err) {
      console.error('[VehicleRideReadySubmit] submit error:', err);
      toast.error(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader
        title="Ride-Ready Certification"
        subtitle={`${vehicle.make} ${vehicle.model} (${vehicle.plate})`}
        backTo="/briefcase"
      />

      {vehicle.ride_ready_status === 'approved' && (
        <Card className="p-4 mb-4 border border-green-200 bg-green-50 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-800">This vehicle is Ride-Ready certified.</p>
        </Card>
      )}

      {vehicle.ride_ready_status === 'pending' && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">Your certificate is under review.</p>
        </Card>
      )}

      {vehicle.ride_ready_status === 'rejected' && (
        <Card className="p-4 mb-4 border border-red-200 bg-red-50 flex items-start gap-2">
          <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-800 font-medium">Your last certificate wasn't approved</p>
            {vehicle.ride_ready_rejection_reason && <p className="text-xs text-red-700 mt-1">{vehicle.ride_ready_rejection_reason}</p>}
            <p className="text-xs text-red-700 mt-1">You can resubmit below.</p>
          </div>
        </Card>
      )}

      {vehicle.ride_ready_status !== 'approved' && (
        <Card className="p-6 border border-border/50">
          <div className="space-y-4">
            <div>
              <Label>Roadworthy Certificate</Label>
              <div className="mt-1">
                {certFile ? (
                  <div className="relative inline-block">
                    <img src={URL.createObjectURL(certFile)} alt="Certificate" className="h-40 w-40 object-cover rounded-lg border border-border" />
                    <button type="button" onClick={() => setCertFile(null)} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-40 w-40 rounded-lg border-2 border-dashed border-border cursor-pointer hover:border-primary/50 transition-colors">
                    <Upload className="w-6 h-6 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">Upload photo</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setCertFile(e.target.files?.[0] || null)} />
                  </label>
                )}
              </div>
            </div>

            <div>
              <Label>Certificate Expiry Date</Label>
              <Input className="mt-1" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>

            <div>
              <Label>Testing Station Name</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Randburg Vehicle Testing Station"
                value={testingStation}
                onChange={(e) => setTestingStation(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Must match an RTMC-accredited station — checked during admin review.</p>
            </div>

            <Button onClick={handleSubmit} className="w-full gap-2" disabled={!canSubmit}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {submitting ? 'Submitting...' : 'Submit for Review'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
