// src/components/chat/ReportUserModal.jsx
//
// "Report and block" form, moved here from the old Messages page so every
// contextual chat (rental and gig) keeps it. Uploads optional screenshots to
// the report-evidence bucket, writes a user_reports row (admin Disputes
// Center reads these), then blocks the user.

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Flag, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

export async function blockUser(meId, otherId) {
  const { error } = await supabase
    .from('blocked_users')
    .upsert({ blocker_id: meId, blocked_id: otherId }, { onConflict: 'blocker_id,blocked_id' });
  if (error) throw error;
}

export default function ReportUserModal({ meId, user, onClose, onBlocked }) {
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const close = () => { if (!submitting) onClose(); };

  const submit = async () => {
    if (!details.trim()) { toast.error('Please describe what happened.'); return; }
    setSubmitting(true);
    try {
      const paths = [];
      for (const file of files) {
        const path = `${meId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: uploadErr } = await supabase.storage.from('report-evidence').upload(path, file);
        if (uploadErr) throw uploadErr;
        paths.push(path);
      }
      const { error: insertErr } = await supabase.from('user_reports').insert({
        reporter_id: meId,
        reported_id: user.id,
        reported_name: user.name || 'User',
        reason: details.trim(), // required (NOT NULL) column
        details: details.trim(),
        screenshot_paths: paths,
      });
      if (insertErr) throw insertErr;
      await blockUser(meId, user.id);
      toast.success('Report submitted — our team will review it.');
      onBlocked?.();
      onClose();
    } catch (err) {
      console.error('[ReportUserModal] report failed:', err);
      toast.error('Could not submit the report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div className="bg-background w-full max-w-md rounded-2xl p-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-destructive" />
            <h2 className="font-bold text-foreground">Report {user.name || 'user'}</h2>
          </div>
          <button onClick={close} className="p-1 rounded-full hover:bg-muted" aria-label="Close">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          This will block {user.name || 'this user'} and send your report to our team for review. Please describe what happened.
        </p>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What happened? Be as specific as possible…"
          rows={4}
          className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-card mb-3 resize-none"
        />

        <p className="text-xs font-medium text-foreground mb-1.5">Screenshots (optional, up to 5)</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {files.map((file, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center"
                aria-label="Remove screenshot"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
          {files.length < 5 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary/40 transition-colors"
              aria-label="Add screenshot"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              if (picked.length) setFiles((prev) => [...prev, ...picked].slice(0, 5));
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={submitting} onClick={close}>Cancel</Button>
          <Button className="flex-1 gap-1.5" disabled={submitting} onClick={submit}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
            Submit & Block
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
