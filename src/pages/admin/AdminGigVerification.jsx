// src/pages/admin/AdminGigVerification.jsx
//
// destination: src/pages/admin/AdminGigVerification.jsx
// (adjust the folder if your admin pages don't actually live under
// src/pages/admin/ — I inferred this from the route name pattern in
// your router, not a confirmed file location)
//
// Visual/interaction pattern matched from AdminPlatformVerification.jsx
// (card list, approve/reject, rejection-reason select+other, refresh).
// DIFFERS deliberately in HOW it writes: calls admin-gig-verification.js
// (service-role Netlify function) rather than a direct client-side
// Supabase update — see chat note on the two coexisting admin
// conventions in this codebase.
//
// BUCKET NAME UNCONFIRMED: 'gig-verification-documents' below is a
// placeholder. Nothing uploads to driver_gig_verification's document
// columns yet (driver-side submission form doesn't exist), so there's
// no real bucket to verify against yet. Fix this string once that
// upload flow exists and the real bucket name is known.

import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, AlertTriangle, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { toast } from 'sonner';

const BUCKET_NAME = 'gig-verification-documents'; // confirmed real bucket name

const DOC_FIELDS = [
  { key: 'drivers_license_url', label: "Driver's Licence" },
  { key: 'id_document_url', label: 'ID / Passport' },
  { key: 'selfie_url', label: 'Selfie' },
  { key: 'pdp_url', label: 'PDP (Professional Driving Permit)' },
  { key: 'police_clearance_url', label: 'Police Clearance' },
];

const REJECTION_REASONS = [
  'Document expired',
  'Document illegible / blurry',
  'Details do not match profile',
  'Selfie does not match ID photo',
  'Missing required document',
  'Other',
];

async function callAdminFn(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');

  const res = await fetch('/.netlify/functions/admin-gig-verification', {
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

export default function AdminGigVerification() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [signedUrls, setSignedUrls] = useState({}); // { [submissionId]: { [field]: url } }
  const [docIssues, setDocIssues] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonOther, setRejectReasonOther] = useState('');

  const fetchPending = async () => {
    setLoading(true);
    try {
      const { submissions } = await callAdminFn('list');
      setPending(submissions || []);

      const urls = {};
      const issues = {};
      await Promise.all((submissions || []).map(async (entry) => {
        urls[entry.id] = {};
        for (const { key } of DOC_FIELDS) {
          const path = entry[key];
          if (!path) continue;
          const { data: signed, error: signErr } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(path, 600);
          if (signed?.signedUrl) {
            urls[entry.id][key] = signed.signedUrl;
          } else {
            issues[entry.id] = issues[entry.id] || [];
            issues[entry.id].push(key);
            console.warn('[AdminGigVerification] createSignedUrl failed:', entry.id, key, signErr);
          }
        }
      }));
      setSignedUrls(urls);
      setDocIssues(issues);
    } catch (err) {
      toast.error('Could not load verification queue: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPending(); }, []);

  const handleReview = async (entry, decision, reason = null) => {
    setProcessingId(entry.id);
    try {
      await callAdminFn('review', { verificationId: entry.id, decision, rejectionReason: reason });
      toast.success(decision === 'approve' ? 'Verification approved' : 'Verification rejected');
      setPending((prev) => prev.filter((p) => p.id !== entry.id));
      setRejectingId(null);
      setRejectReason('');
      setRejectReasonOther('');
    } catch (err) {
      toast.error('Failed to update: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const confirmReject = (entry) => {
    const finalReason = rejectReason === 'Other' ? rejectReasonOther.trim() : rejectReason;
    if (!finalReason) { toast.error('Please select or enter a rejection reason'); return; }
    handleReview(entry, 'reject', finalReason);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gig Verification</h2>
          <p className="text-sm text-muted-foreground">
            {pending.length > 0 ? `${pending.length} pending request${pending.length !== 1 ? 's' : ''}` : 'Delivery-Ready / Passenger-Ready driver review'}
          </p>
        </div>
        <button onClick={fetchPending} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      {!loading && pending.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">
          No pending Gig verification requests.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pending.map((entry) => (
          <div key={entry.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold text-sm">{entry.profile?.full_name || 'Unknown user'}</p>
                <p className="text-xs text-muted-foreground">{entry.profile?.email}</p>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-primary/10 text-primary">
                {entry.tier === 'passenger_ready' ? 'Passenger-Ready' : 'Delivery-Ready'}
              </span>
            </div>

            <div className="space-y-2 mb-3">
              {DOC_FIELDS.filter(({ key }) => entry[key]).map(({ key, label }) => (
                <div key={key}>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
                  {signedUrls[entry.id]?.[key] ? (
                    <img
                      src={signedUrls[entry.id][key]}
                      alt={label}
                      className="w-full max-h-48 object-contain rounded-lg border border-border bg-muted"
                    />
                  ) : (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 text-amber-700 text-xs border border-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Could not load document
                    </div>
                  )}
                </div>
              ))}
              {DOC_FIELDS.every(({ key }) => !entry[key]) && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 text-xs border border-amber-200">
                  <FileText className="w-4 h-4 shrink-0" /> No documents attached
                </div>
              )}
            </div>

            {rejectingId === entry.id ? (
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
                  <button disabled={processingId === entry.id} onClick={() => confirmReject(entry)} className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-60">
                    {processingId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Confirm Rejection
                  </button>
                  <button onClick={() => { setRejectingId(null); setRejectReason(''); setRejectReasonOther(''); }} className="text-sm px-3 py-1.5 rounded-lg">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button disabled={processingId === entry.id} onClick={() => handleReview(entry, 'approve')} className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 bg-green-50 disabled:opacity-60">
                  {processingId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve
                </button>
                <button disabled={processingId === entry.id} onClick={() => setRejectingId(entry.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border text-red-600 border-red-300 disabled:opacity-60">
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
