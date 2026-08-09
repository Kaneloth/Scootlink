import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Flag, AlertTriangle, CheckCircle2, XCircle, Ban } from 'lucide-react';
import { toast } from 'sonner';

export default function AdminDisputesCenter() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signedUrls, setSignedUrls] = useState({});
  const [processingId, setProcessingId] = useState(null);
  const [notesById, setNotesById] = useState({});
  const [previewImage, setPreviewImage] = useState(null);

  const fetchReports = async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('user_reports')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      toast.error('Could not load disputes: ' + error.message);
      setLoading(false);
      return;
    }

    const userIds = [...new Set((rows || []).flatMap(r => [r.reporter_id, r.reported_id]))];
    const { data: profiles } = userIds.length
      ? await supabase.from('profiles').select('id, full_name, email, customer_code').in('id', userIds)
      : { data: [] };
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

    const merged = (rows || []).map(r => ({
      ...r,
      reporter: profileMap[r.reporter_id] || null,
      reported: profileMap[r.reported_id] || null,
    }));
    setReports(merged);

    const urls = {};
    await Promise.all(merged.flatMap(r => (r.screenshot_paths || []).map(async (path) => {
      const { data: signed } = await supabase.storage.from('report-evidence').createSignedUrl(path, 600);
      if (signed?.signedUrl) urls[path] = signed.signedUrl;
    })));
    setSignedUrls(urls);
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  // Finalizing a report (resolved OR dismissed) clears the evidence from
  // storage — reports don't need the actual screenshots retained forever,
  // just the record that the report happened and how it was closed.
  const finalizeReport = async (report, status) => {
    setProcessingId(report.id);
    try {
      if (report.screenshot_paths?.length) {
        const { error: delErr } = await supabase.storage.from('report-evidence').remove(report.screenshot_paths);
        if (delErr) console.warn('[AdminDisputesCenter] evidence cleanup failed (non-fatal):', delErr.message);
      }

      const { data: { user: adminUser } } = await supabase.auth.getUser();
      const { error } = await supabase.from('user_reports').update({
        status,
        admin_notes: notesById[report.id] || null,
        reviewed_by: adminUser?.id || null,
        reviewed_at: new Date().toISOString(),
        screenshot_paths: [],
      }).eq('id', report.id);

      if (error) throw error;

      // Let the reporter know the outcome — this is the whole point of them
      // having filed the report in the first place; silently closing it
      // with no feedback would be a bad experience.
      const reportedLabel = report.reported?.full_name || report.reported_name || 'the user you reported';
      try {
        await supabase.rpc('create_notification', {
          p_user_id: report.reporter_id,
          p_type: 'dispute_update',
          p_title: status === 'resolved' ? 'Your report has been resolved' : 'Your report has been reviewed',
          p_body: status === 'resolved'
            ? `We reviewed your report about ${reportedLabel} and took action. Thank you for helping keep Skootlink safe.`
            : `We reviewed your report about ${reportedLabel} and closed it without further action.`,
          p_data: { report_id: report.id },
        });
      } catch (notifyErr) {
        console.warn('[AdminDisputesCenter] Failed to notify reporter (non-fatal):', notifyErr?.message);
      }

      toast.success(status === 'resolved' ? 'Dispute marked resolved' : 'Dispute dismissed');
      setReports(prev => prev.filter(r => r.id !== report.id));
    } catch (err) {
      toast.error('Failed to finalize: ' + err.message);
    }
    setProcessingId(null);
  };

  const banReportedUser = async (report) => {
    setProcessingId(report.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/admin-ban-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ userId: report.reported_id, reason: `Reported: ${report.details.slice(0, 100)}` }),
      });
      if (!res.ok) throw new Error('Ban request failed');
      toast.success(`${report.reported?.full_name || 'User'} has been banned.`);
    } catch (err) {
      toast.error('Could not ban user: ' + err.message);
    }
    setProcessingId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Flag className="w-5 h-5" /> Disputes Center</h2>
          <p className="text-sm text-muted-foreground">
            {reports.length > 0 ? `${reports.length} pending report${reports.length !== 1 ? 's' : ''}` : 'User reports from Messages'}
          </p>
        </div>
        <button onClick={fetchReports} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'} Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : reports.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">
          No pending disputes.
        </p>
      ) : (
        <div className="space-y-4">
          {reports.map(r => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm">
                    <span className="font-semibold">{r.reporter?.full_name || 'Unknown'}</span>
                    <span className="text-muted-foreground"> reported </span>
                    <span className="font-semibold">{r.reported?.full_name || r.reported_name || 'Unknown'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.reporter?.email} → {r.reported?.email} · {new Date(r.created_at).toLocaleString('en-ZA')}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium shrink-0">Pending</span>
              </div>

              <div className="text-sm mb-3 p-3 rounded-lg bg-muted/50 whitespace-pre-wrap">{r.details}</div>

              {r.screenshot_paths?.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {r.screenshot_paths.map((path) => {
                    const url = signedUrls[path];
                    return url ? (
                      <img
                        key={path}
                        src={url}
                        alt="Evidence"
                        onClick={() => setPreviewImage(url)}
                        className="w-20 h-20 object-cover rounded-lg border border-border cursor-pointer hover:opacity-80 transition-opacity"
                      />
                    ) : (
                      <div key={path} className="w-20 h-20 rounded-lg border border-border bg-muted flex items-center justify-center">
                        <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                      </div>
                    );
                  })}
                </div>
              )}

              <input
                placeholder="Internal notes (optional)…"
                value={notesById[r.id] || ''}
                onChange={e => setNotesById(prev => ({ ...prev, [r.id]: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-1.5 text-sm mb-3 bg-background"
              />

              <div className="flex gap-2">
                <button
                  disabled={processingId === r.id}
                  onClick={() => finalizeReport(r, 'resolved')}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-green-300 text-green-700 bg-green-50 disabled:opacity-60"
                >
                  {processingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Resolve
                </button>
                <button
                  disabled={processingId === r.id}
                  onClick={() => finalizeReport(r, 'dismissed')}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border text-muted-foreground disabled:opacity-60"
                >
                  <XCircle className="w-3.5 h-3.5" /> Dismiss
                </button>
                <button
                  disabled={processingId === r.id}
                  onClick={() => banReportedUser(r)}
                  className="flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-red-300 text-red-700 disabled:opacity-60"
                >
                  <Ban className="w-3.5 h-3.5" /> Ban
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} alt="Evidence preview" className="max-w-full max-h-[90vh] rounded-xl object-contain" onClick={e => e.stopPropagation()} />
          <button onClick={() => setPreviewImage(null)} className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 rounded-full w-9 h-9 flex items-center justify-center text-xl">×</button>
        </div>
      )}
    </div>
  );
}
