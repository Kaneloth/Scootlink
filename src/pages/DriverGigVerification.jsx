// src/pages/DriverGigVerification.jsx
//
// Driver-facing Gig-Ready verification (free — §5.11). Route /gig-verification.
// Pattern matched from VerificationPanel.jsx: compress each image client-side
// (lib/imageCompress.js), send base64 JSON to submit-gig-verification, which
// does the Storage upload and row write.
//
// Modes:
//   - New submission: Delivery-Ready (licence, ID, selfie) or Passenger-Ready
//     (+ PDP, police clearance, PDP expiry date).
//   - Approved Delivery-Ready driver: "Upgrade to Passenger-Ready" — only PDP,
//     police clearance and PDP expiry; they keep doing deliveries while it's
//     reviewed (migration 016).
//   - Approved Passenger-Ready driver: "Renew your PDP" — same documents; they
//     stay Passenger-Ready while it's reviewed. A lapsed PDP drops them to
//     Delivery-Ready automatically (daily gig-document-expiry job).

import React, { useState, useEffect } from 'react';
import { auth, supabase } from '@/api/supabaseData';
import { compressImage } from '@/lib/imageCompress';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Loader2, CheckCircle2, Clock, XCircle, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';
import { fnUrl } from '@/lib/functionsUrl';

const REQUIRED_DOCS_BY_TIER = {
  delivery_ready: ['license', 'id', 'selfie'],
  passenger_ready: ['license', 'id', 'selfie', 'pdp', 'policeClearance'],
};
const UPGRADE_DOCS = ['pdp', 'policeClearance'];

const DOC_LABELS = {
  license: "Driver's Licence",
  id: 'ID / Passport',
  selfie: 'Selfie',
  pdp: 'PDP (Professional Driving Permit)',
  policeClearance: 'Police Clearance Certificate',
};

const longDate = (d) => new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

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
  const [existing, setExisting] = useState(null); // verification row | null
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState('delivery_ready');
  const [files, setFiles] = useState({});
  const [pdpExpiry, setPdpExpiry] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await auth.me();
      if (!user?.id) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('driver_gig_verification')
        .select('tier, status, rejection_reason, pdp_expiry_date, upgrade_status, upgrade_rejection_reason')
        .eq('driver_id', user.id)
        .maybeSingle();
      if (error) console.error('[DriverGigVerification] load failed:', error);
      setExisting(data || null);
      setLoading(false);
    })();
  }, []);

  const approved = existing?.status === 'approved';
  const isPassenger = approved && existing.tier === 'passenger_ready';
  const upgradePending = approved && existing.upgrade_status === 'pending';
  // Approved drivers can submit an upgrade (Delivery) or PDP renewal (Passenger)
  const upgradeMode = approved && !upgradePending;
  const showForm = !approved ? existing?.status !== 'pending' : upgradeMode;

  const requiredDocs = upgradeMode ? UPGRADE_DOCS : REQUIRED_DOCS_BY_TIER[tier];
  const needsPdpExpiry = upgradeMode || tier === 'passenger_ready';
  const canSubmit = requiredDocs.every((d) => files[d]) && (!needsPdpExpiry || pdpExpiry) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const compressed = {};
      await Promise.all(
        requiredDocs.map(async (d) => { compressed[d] = await compressImage(files[d]); })
      );

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(fnUrl('submit-gig-verification'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          tier: upgradeMode ? 'passenger_ready' : tier,
          licenseImageBase64: compressed.license,
          idImageBase64: compressed.id,
          selfieImageBase64: compressed.selfie,
          pdpImageBase64: compressed.pdp,
          policeClearanceImageBase64: compressed.policeClearance,
          pdpExpiryDate: needsPdpExpiry ? pdpExpiry : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      if (data.alreadyVerified || data.alreadyPending) {
        toast(data.message);
      } else {
        toast.success(data.message || 'Submitted! We\'ll review your documents shortly.');
      }
      if (data.upgradePending) {
        setExisting((prev) => ({ ...prev, upgrade_status: 'pending', upgrade_rejection_reason: null }));
      } else if (!data.alreadyVerified && !data.alreadyPending) {
        setExisting({ tier, status: 'pending', rejection_reason: null });
      }
      setFiles({});
      setPdpExpiry('');
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
      <PageHeader title="Gig-Ready Verification" subtitle="Free — required to accept ride and delivery gigs" backTo="/gigs" />

      {approved && (
        <Card className="p-4 mb-4 border border-green-200 bg-green-50 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-800">
            You're {isPassenger ? 'Passenger-Ready' : 'Delivery-Ready'}. You can accept {isPassenger ? 'rides and deliveries' : 'delivery gigs'}.
            {isPassenger && existing.pdp_expiry_date && ` Your PDP is on file until ${longDate(existing.pdp_expiry_date)}.`}
          </p>
        </Card>
      )}

      {existing?.status === 'pending' && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">Your submission is under review.</p>
        </Card>
      )}

      {upgradePending && (
        <Card className="p-4 mb-4 border border-amber-200 bg-amber-50 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            Your {isPassenger ? 'PDP renewal' : 'Passenger-Ready upgrade'} is under review. You keep your current status meanwhile.
          </p>
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

      {approved && existing.upgrade_status === 'rejected' && (
        <Card className="p-4 mb-4 border border-red-200 bg-red-50 flex items-start gap-2">
          <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-800 font-medium">
              Your {isPassenger ? 'PDP renewal' : 'Passenger-Ready upgrade'} wasn't approved
            </p>
            {existing.upgrade_rejection_reason && <p className="text-xs text-red-700 mt-1">{existing.upgrade_rejection_reason}</p>}
            <p className="text-xs text-red-700 mt-1">You can resubmit below.</p>
          </div>
        </Card>
      )}

      {showForm && (
        <Card className="p-6 border border-border/50">
          <div className="space-y-4">
            {upgradeMode ? (
              <div>
                <p className="font-semibold text-sm">{isPassenger ? 'Renew your PDP' : 'Upgrade to Passenger-Ready'}</p>
                <p className="text-xs text-muted-foreground">
                  {isPassenger
                    ? 'Upload your renewed Professional Driving Permit and a current police clearance. You stay Passenger-Ready while we review.'
                    : 'Accept rides as well as deliveries. Upload your PDP and police clearance. You keep doing deliveries while we review.'}
                </p>
              </div>
            ) : (
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
            )}

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

            {needsPdpExpiry && (
              <div>
                <Label htmlFor="pdp-expiry">PDP expiry date</Label>
                <Input
                  id="pdp-expiry"
                  className="mt-1"
                  type="date"
                  value={pdpExpiry}
                  onChange={(e) => setPdpExpiry(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  As printed on your PDP. We'll remind you before it expires.
                </p>
              </div>
            )}

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
