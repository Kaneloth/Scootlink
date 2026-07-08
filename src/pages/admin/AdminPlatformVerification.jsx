// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Star, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const REJECTION_REASONS = [
  'Rating does not match evidence',
  'Screenshot is not from this platform',
  'Screenshot is blurry or unreadable',
  'Platform name does not match screenshot',
  'Other',
];

export default function AdminPlatformVerification() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [signedUrls, setSignedUrls] = useState({});
  const [evidenceIssues, setEvidenceIssues] = useState({});
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectReasonOther, setRejectReasonOther] = useState('');

  const fetchPending = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('platform_history')
      .select('*, profiles!user_id(full_name, email)')
      .eq('verification_status', 'pending')
      .order('created_at', { ascending: true });
    if (!error) {
      setPending(data || []);
      const urls = {};
      const issues = {};
      await Promise.all((data || []).map(async (entry) => {
        if (!entry.evidence_url) {
          issues[entry.id] = 'No screenshot was attached to this request.';
          return;
        }
        const { data: signed, error: signErr } = await supabase.storage
          .from('platform-evidence')
          .createSignedUrl(entry.evidence_url, 600);
        if (signed?.signedUrl) {
          urls[entry.id] = signed.signedUrl;
        } else {
          console.warn('[AdminPlatformVerification] createSignedUrl failed:', entry.id, signErr);
          issues[entry.id] = 'Could not load the screenshot (' + (signErr?.message || 'unknown error') + ').';
        }
      }));
      setSignedUrls(urls);
      setEvidenceIssues(issues);
    } else {
      toast.error('Could not load verification queue: ' + error.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchPending(); }, []);

  const handleReview = async (entry, approve, reason = null) => {
    setProcessingId(entry.id);
    const { data: { user: adminUser } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('platform_history')
      .update({
        verification_status: approve ? 'verified' : 'rejected',
        rejection_reason: approve ? null : reason,
        reviewed_by: adminUser?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', entry.id);
    if (error) {
      toast.error('Failed to update: ' + error.message);
    } else {
      toast.success(approve ? 'Platform history approved' : 'Platform history rejected');
      setPending(prev => prev.filter(p => p.id !== entry.id));
      setRejectingId(null);
      setRejectReason('');
      setRejectReasonOther('');
    }
    setProcessingId(null);
  };

  const confirmReject = (entry) => {
    const finalReason = rejectReason === 'Other' ? rejectReasonOther.trim() : rejectReason;
    if (!finalReason) { toast.error('Please select or enter a rejection reason'); return; }
    handleReview(entry, false, finalReason);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Platform Verification</h2>
          <p className="text-sm text-muted-foreground">
            {pending.length > 0 ? `${pending.length} pending request${pending.length !== 1 ? 's' : ''}` : 'Manual review of driver platform ratings'}
          </p>
        </div>
        <button
          onClick={fetchPending}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
        >
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
          No pending platform verification requests.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pending.map(entry => (
          <div key={entry.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold text-sm">{entry.profiles?.full_name || 'Unknown user'}</p>
                <p className="text-xs text-muted-foreground">{entry.profiles?.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-semibold text-sm">{entry.platform}</span>
                <span className="flex items-center gap-0.5 text-amber-500 text-xs font-semibold">
                  <Star className="w-3.5 h-3.5 fill-current" /> {Number(entry.rating).toFixed(1)}
                </span>
              </div>
            </div>

            {signedUrls[entry.id] ? (
              <img
                src={signedUrls[entry.id]}
                alt="Evidence screenshot"
                className="w-full max-h-64 object-contain rounded-lg border border-border mb-3 bg-muted"
              />
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 text-amber-700 text-xs mb-3 border border-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {evidenceIssues[entry.id] || 'No screenshot available for this request.'}
              </div>
            )}

            {rejectingId === entry.id ? (
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
                    disabled={processingId === entry.id}
                    onClick={() => confirmReject(entry)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-60"
                  >
                    {processingId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                    Confirm Rejection
                  </button>
                  <button
                    onClick={() => { setRejectingId(null); setRejectReason(''); setRejectReasonOther(''); }}
                    className="text-sm px-3 py-1.5 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  disabled={processingId === entry.id}
                  onClick={() => handleReview(entry, true)}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 bg-green-50 disabled:opacity-60"
                >
                  {processingId === entry.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approve
                </button>
                <button
                  disabled={processingId === entry.id}
                  onClick={() => setRejectingId(entry.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border text-red-600 border-red-300 disabled:opacity-60"
                >
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
