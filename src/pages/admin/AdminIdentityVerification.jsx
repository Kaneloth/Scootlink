import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

const SERVICE_LABELS = {
  sa_id: 'RSA ID',
  passport: 'Passport',
  licence: "Driver's Licence",
};

const REJECTION_REASONS = [
  'Photo too blurry to read',
  'Details do not match the document',
  'Selfie does not match the document photo',
  'Suspected fake or altered document',
  'Name does not match profile',
  'Other',
];

export default function AdminIdentityVerification() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signedUrls, setSignedUrls] = useState({});
  const [processingId, setProcessingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonOther, setRejectReasonOther] = useState('');

  const fetchPending = async () => {
    setLoading(true);
    const { data: submissions, error } = await supabase
      .from('identity_verification_submissions')
      .select('*')
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      toast.error('Could not load verification queue: ' + error.message);
      setLoading(false);
      return;
    }

    const userIds = [...new Set((submissions || []).map(s => s.user_id))];
    const { data: profiles } = userIds.length
      ? await supabase.from('profiles').select('id, full_name, email, customer_code').in('id', userIds)
      : { data: [] };
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

    const merged = (submissions || []).map(s => ({ ...s, profile: profileMap[s.user_id] || null }));
    setPending(merged);

    // Sign every document image up front
    const urls = {};
    await Promise.all(merged.flatMap(s => [
      ['document_front_path', s.document_front_path],
      ['document_back_path', s.document_back_path],
      ['selfie_path', s.selfie_path],
    ].filter(([, path]) => path).map(async ([key, path]) => {
      const { data: signed } = await supabase.storage.from('identity-documents').createSignedUrl(path, 600);
      if (signed?.signedUrl) urls[`${s.id}_${key}`] = signed.signedUrl;
    })));
    setSignedUrls(urls);
    setLoading(false);
  };

  useEffect(() => { fetchPending(); }, []);

  const review = async (submission, action, reason = null) => {
    setProcessingId(submission.id);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('https://skootlink.co.za/.netlify/functions/admin-review-identity-verification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ submissionId: submission.id, action, rejectionReason: reason }),
    });

    if (res.ok) {
      toast.success(action === 'approve' ? 'Verification approved ✓' : 'Verification rejected');
      setPending(prev => prev.filter(p => p.id !== submission.id));
      setRejectingId(null);
      setRejectReason('');
      setRejectReasonOther('');
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Action failed');
    }
    setProcessingId(null);
  };

  const confirmReject = (submission) => {
    const finalReason = rejectReason === 'Other' ? rejectReasonOther.trim() : rejectReason;
    if (!finalReason) { toast.error('Please select or enter a rejection reason'); return; }
    review(submission, 'reject', finalReason);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Identity Verification</h2>
          <p className="text-sm text-muted-foreground">
            {pending.length > 0 ? `${pending.length} pending submission${pending.length !== 1 ? 's' : ''}` : 'SA ID, Passport, and Licence document review'}
          </p>
        </div>
        <button onClick={fetchPending} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : pending.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">
          No pending identity verifications.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pending.map(s => (
            <div key={s.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    {s.profile?.full_name || 'Unknown user'}
                    <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
                  </p>
                  <p className="text-xs text-muted-foreground">{s.profile?.email} · {s.profile?.customer_code}</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium shrink-0 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {SERVICE_LABELS[s.service_type]}
                </span>
              </div>

              <div className="text-sm mb-3 p-2 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">Number on document: </span>
                <span className="font-mono font-semibold">{s.id_or_licence_number}</span>
                <p className="text-xs text-muted-foreground mt-1">
                  Compare the name on the document photo below against <span className="font-semibold">{s.profile?.full_name || 'the profile name above'}</span> — this replaces the automated name check VerifyNow used to do.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  ['document_front_path', 'Front'],
                  ['document_back_path', 'Back'],
                  ['selfie_path', 'Selfie'],
                ].map(([key, label]) => {
                  const url = signedUrls[`${s.id}_${key}`];
                  return (
                    <div key={key} className="text-center">
                      {url ? (
                        <img src={url} alt={label} className="w-full aspect-square object-cover rounded-lg border border-border" />
                      ) : (
                        <div className="w-full aspect-square rounded-lg border border-border bg-muted flex items-center justify-center">
                          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
                    </div>
                  );
                })}
              </div>

              {rejectingId === s.id ? (
                <div className="space-y-2 border border-border rounded-xl p-3">
                  <p className="text-xs font-semibold">Reason for rejection</p>
                  <select
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm bg-background"
                  >
                    <option value="" disabled>Select a reason</option>
                    {REJECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {rejectReason === 'Other' && (
                    <input
                      placeholder="Type the reason…"
                      value={rejectReasonOther}
                      onChange={e => setRejectReasonOther(e.target.value)}
                      className="w-full border rounded-lg px-2 py-1.5 text-sm"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      disabled={processingId === s.id}
                      onClick={() => confirmReject(s)}
                      className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-60"
                    >
                      {processingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                      Confirm Rejection
                    </button>
                    <button
                      onClick={() => { setRejectingId(null); setRejectReason(''); setRejectReasonOther(''); }}
                      className="text-sm px-3 py-1.5 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Rejecting allows the user one free re-submission — no additional payment required.</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    disabled={processingId === s.id}
                    onClick={() => review(s, 'approve')}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 bg-green-50 disabled:opacity-60"
                  >
                    {processingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Approve
                  </button>
                  <button
                    disabled={processingId === s.id}
                    onClick={() => setRejectingId(s.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border text-red-600 border-red-300 disabled:opacity-60"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
