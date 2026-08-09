// src/pages/DriverGigVerification.jsx
//
// destination: src/pages/DriverGigVerification.jsx
//
// Driver-facing submission for Delivery-Ready / Passenger-Ready tiers.
// Pattern matched from VerificationPanel.jsx's real flow: compress each
// image client-side (compressImage, extracted to lib/imageCompress.js),
// send as base64 JSON to a Netlify function, function does the actual
// Storage upload + row write.
//
// UI markup (file inputs, thumbnails) is NOT copied from
// VerificationPanel.jsx — I only had its logic/state, not the actual
// upload-button JSX, so this is a reasonable approximation rather than
// a pixel-match. Compare against VerificationPanel.jsx's real markup if
// you want this to look identical.
//
// No payment gate — Gig-Ready is free per the decided monetization
// model (§5.11).

import React, { useState, useEffect } from 'react';
import { auth, supabase } from '@/api/supabaseData';
import { compressImage } from '@/lib/imageCompress';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, CheckCircle2, Clock, XCircle, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';

const REQUIRED_DOCS_BY_TIER = {
  delivery_ready: ['license', 'id', 'selfie'],
  passenger_ready: ['license', 'id', 'selfie', 'pdp', 'policeClearance'],
};

const DOC_LABELS = {
  license: "Driver's Licence",
  id: 'ID / Passport',
  selfie: 'Selfie',
  pdp: 'PDP (Professional Driving Permit)',
  policeClearance: 'Police Clearance Certificate',
};

function FileSlot({ label, file, onChange }) {
  return (
    <div>
      <p className="text-xs font-medium mb-1">{label}</p>
      {file ? (
        <div className="relative inline-block">
          <img src={URL.createObjectURL(file)} alt={label} className="h-24 w-24 object-cover rounded-lg border border-border" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center h-24 w-24 rounded-lg border-2 border-dashed border-border cursor-pointer hover:border-primary/50 transition-colors">
          <Upload className="w-5 h-5 text-muted-foreground" />
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onChange(e.target.files?.[0] || null)} />
        </label>
      )}
    </div>
  );
}

export default function DriverGigVerification() {
  const [existing, setExisting] = useState(null); // { tier, status, rejection_reason } | null
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState('delivery_ready');
  const [files, setFiles] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await auth.me();
      if (!user?.id) { setLoading(false); return; }
      const { data } = await supabase
        .from('driver_gig_verification')
        .select('tier, status, rejection_reason')
        .eq('driver_id', user.id)
        .maybeSingle();
      setExisting(data || null);
      setLoading(false);
    })();
  }, []);

  const requiredDocs = REQUIRED_DOCS_BY_TIER[tier];
  const canSubmit = requiredDocs.every((d) => files[d]) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const compressed = {};
      await Promise.all(
        requiredDocs.map(async (d) => { compressed[d] = await compressImage(files[d]); })
      );

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/submit-gig-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          tier,
          licenseImageBase64: compressed.license,
          idImageBase64: compressed.id,
          selfieImageBase64: compressed.selfie,
          pdpImageBase64: compressed.pdp,
          policeClearanceImageBase64: compressed.policeClearance,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      if (data.alreadyVerified) {
        toast.success(data.message);
      } else if (data.alreadyPending) {
        toast(data.message);
      } else {
        toast.success('Submitted! We\'ll review your documents shortly.');
      }
      setExisting({ tier, status: data.alreadyVerified ? 'approved' : 'pending', rejection_reason: null });
      setFiles({});
    } catch (err) {
      console.error('[DriverGigVerification] submit error:', err);
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
      <PageHeader title="Gig-Ready Verification" subtitle="Free — required to accept ride and delivery gigs" backTo="/home" />

      {existing?.status === 'approved' && (
        <Card className="p-4 mb-4 border border-green-200 bg-green-50 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-800">
            You're {existing.tier === 'passenger_ready' ? 'Passenger-Ready' : 'Delivery-Ready'}. You can accept matching gigs.
          </p>
        </Card>
      )}

      {existing?.status === 'pending' && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">Your submission is under review.</p>
        </Card>
      )}

      {existing?.status === 'rejected' && (
        <Card className="p-4 mb-4 border border-red-200 bg-red-50 flex items-start gap-2">
          <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-800 font-medium">Your last submission wasn't approved</p>
            {existing.rejection_reason && <p className="text-xs text-red-700 mt-1">{existing.rejection_reason}</p>}
            <p className="text-xs text-red-700 mt-1">You can resubmit below.</p>
          </div>
        </Card>
      )}

      {existing?.status !== 'approved' && (
        <Card className="p-6 border border-border/50">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTier('delivery_ready')}
                className={`p-3 rounded-xl border-2 text-left ${tier === 'delivery_ready' ? 'border-primary bg-primary/5' : 'border-border/50'}`}
              >
                <p className="font-semibold text-sm">Delivery-Ready</p>
                <p className="text-xs text-muted-foreground">Delivery gigs only</p>
              </button>
              <button
                onClick={() => setTier('passenger_ready')}
                className={`p-3 rounded-xl border-2 text-left ${tier === 'passenger_ready' ? 'border-primary bg-primary/5' : 'border-border/50'}`}
              >
                <p className="font-semibold text-sm">Passenger-Ready</p>
                <p className="text-xs text-muted-foreground">Rides + deliveries</p>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {requiredDocs.map((d) => (
                <FileSlot
                  key={d}
                  label={DOC_LABELS[d]}
                  file={files[d]}
                  onChange={(f) => setFiles((prev) => ({ ...prev, [d]: f }))}
                />
              ))}
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
