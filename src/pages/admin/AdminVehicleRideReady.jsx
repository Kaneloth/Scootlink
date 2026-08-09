// src/pages/admin/AdminVehicleRideReady.jsx
//
// destination: src/pages/admin/AdminVehicleRideReady.jsx
// (same folder caveat as AdminGigVerification.jsx — inferred, not confirmed)
//
// Same pattern as AdminGigVerification.jsx: visual style from
// AdminPlatformVerification.jsx, writes via the service-role
// admin-vehicle-ride-ready.js function.
//
// BUCKET NAME UNCONFIRMED: 'vehicle-documents' below is a placeholder —
// same caveat as the other admin page. No upload flow exists yet for
// roadworthy_certificate_url.
//
// Includes the §5.5 checklist as an on-screen reminder for whoever is
// reviewing (expiry date, VIN match, station accreditation) — this is
// NOT automated, just a checklist prompt; the actual decision is a
// human judgment call, same as identity verification.

import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, AlertTriangle, CheckCircle2, XCircle, Calendar } from 'lucide-react';
import { toast } from 'sonner';

const BUCKET_NAME = 'vehicle-ride-ready-documents'; // confirmed real bucket name

const REJECTION_REASONS = [
  'Certificate expired',
  'VIN does not match vehicle listing',
  'Testing station not found on RTMC accredited list',
  'Certificate format/logo inconsistent with station template',
  'Document illegible / blurry',
  'Other',
];

async function callAdminFn(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');

  const res = await fetch('/.netlify/functions/admin-vehicle-ride-ready', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function AdminVehicleRideReady() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonOther, setRejectReasonOther] = useState('');

  const fetchPending = async () => {
    setLoading(true);
    try {
      const { vehicles } = await callAdminFn('list');
      setPending(vehicles || []);

      const urls = {};
      await Promise.all((vehicles || []).map(async (v) => {
        if (!v.roadworthy_certificate_url) return;
        const { data: signed, error: signErr } = await supabase.storage
          .from(BUCKET_NAME)
          .createSignedUrl(v.roadworthy_certificate_url, 600);
        if (signed?.signedUrl) {
          urls[v.id] = signed.signedUrl;
        } else {
          console.warn('[AdminVehicleRideReady] createSignedUrl failed:', v.id, signErr);
        }
      }));
      setSignedUrls(urls);
    } catch (err) {
      toast.error('Could not load verification queue: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPending(); }, []);

  const handleReview = async (vehicle, decision, reason = null) => {
    setProcessingId(vehicle.id);
    try {
      await callAdminFn('review', { vehicleId: vehicle.id, decision, rejectionReason: reason });
      toast.success(decision === 'approve' ? 'Vehicle approved as Ride-Ready' : 'Certification rejected');
      setPending((prev) => prev.filter((v) => v.id !== vehicle.id));
      setRejectingId(null);
      setRejectReason('');
      setRejectReasonOther('');
    } catch (err) {
      toast.error('Failed to update: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const confirmReject = (vehicle) => {
    const finalReason = rejectReason === 'Other' ? rejectReasonOther.trim() : rejectReason;
    if (!finalReason) { toast.error('Please select or enter a rejection reason'); return; }
    handleReview(vehicle, 'reject', finalReason);
  };

  const isExpired = (dateStr) => dateStr && new Date(dateStr) < new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Vehicle Ride-Ready Review</h2>
          <p className="text-sm text-muted-foreground">
            {pending.length > 0 ? `${pending.length} pending request${pending.length !== 1 ? 's' : ''}` : 'Roadworthy certificate review'}
          </p>
        </div>
        <button onClick={fetchPending} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
        </button>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 text-blue-800 text-xs border border-blue-200">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Review checklist</p>
          <p>1. Certificate not expired &nbsp;•&nbsp; 2. VIN matches listing &nbsp;•&nbsp; 3. Testing station is on the RTMC accredited list (rtmc.co.za) &nbsp;•&nbsp; 4. Format/logo consistent with that station's known template</p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && pending.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">
          No pending Ride-Ready requests.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pending.map((v) => (
          <div key={v.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold text-sm">{v.make} {v.model} ({v.year})</p>
                <p className="text-xs text-muted-foreground">{v.owner?.full_name} — {v.owner?.email}</p>
                <p className="text-xs text-muted-foreground">Plate: {v.plate}</p>
              </div>
              {v.roadworthy_expiry_date && (
                <span className={`text-xs font-semibold px-2 py-1 rounded-full flex items-center gap-1 ${isExpired(v.roadworthy_expiry_date) ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  <Calendar className="w-3 h-3" /> {new Date(v.roadworthy_expiry_date).toLocaleDateString('en-ZA')}
                </span>
              )}
            </div>

            {v.roadworthy_testing_station && (
              <p className="text-xs text-muted-foreground mb-2">Station: {v.roadworthy_testing_station}</p>
            )}

            {signedUrls[v.id] ? (
              <img
                src={signedUrls[v.id]}
                alt="Roadworthy certificate"
                className="w-full max-h-64 object-contain rounded-lg border border-border mb-3 bg-muted"
              />
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 text-xs mb-3 border border-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Could not load certificate
              </div>
            )}

            {isExpired(v.roadworthy_expiry_date) && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 text-red-700 text-xs mb-3 border border-red-200">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> This certificate's expiry date has already passed
              </div>
            )}

            {rejectingId === v.id ? (
              <div className="space-y-2 border border-border rounded-xl p-3">
                <p className="text-xs font-semibold">Reason for rejection</p>
                <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm bg-background">
                  <option value="" disabled>Select a reason</option>
                  {REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {rejectReason === 'Other' && (
                  <input placeholder="Type the reason…" value={rejectReasonOther} onChange={(e) => setRejectReasonOther(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                )}
                <div className="flex gap-2">
                  <button disabled={processingId === v.id} onClick={() => confirmReject(v)} className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-60">
                    {processingId === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Confirm Rejection
                  </button>
                  <button onClick={() => { setRejectingId(null); setRejectReason(''); setRejectReasonOther(''); }} className="text-sm px-3 py-1.5 rounded-lg">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button disabled={processingId === v.id} onClick={() => handleReview(v, 'approve')} className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 bg-green-50 disabled:opacity-60">
                  {processingId === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve
                </button>
                <button disabled={processingId === v.id} onClick={() => setRejectingId(v.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border text-red-600 border-red-300 disabled:opacity-60">
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
