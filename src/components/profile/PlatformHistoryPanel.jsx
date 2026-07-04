/**
 * PlatformHistoryPanel.jsx — lets existing drivers add/edit/remove their
 * self-reported gig-platform work history from the Profile page, same
 * feature as the onboarding step, but for accounts that already exist.
 *
 * Unlike the onboarding step (which batches everything into one save at the
 * end), each action here persists immediately — consistent with the rest of
 * the Profile page's instant-save pattern (e.g. the visibility toggles).
 *
 * Place at: src/components/profile/PlatformHistoryPanel.jsx
 */
import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Star, Upload, Trash2, Plus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

const PLATFORM_OPTIONS = ['Uber', 'Bolt', 'Uber Eats', 'Mr D Food', 'Bolt Food', 'InDriver', 'Other'];

const emptyForm = { platform: '', otherPlatform: '', role: '', rating: 0, evidenceFile: null, requestVerification: false };

export default function PlatformHistoryPanel({ user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchEntries = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('platform_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (!error) setEntries(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchEntries(); }, [user?.id]);

  const handleSave = async () => {
    const platformName = form.platform === 'Other' ? form.otherPlatform.trim() : form.platform;
    if (!platformName) { toast.error('Please select or enter a platform name'); return; }
    if (!form.rating) { toast.error('Please select a rating'); return; }
    if (form.requestVerification && !form.evidenceFile) {
      toast.error('Please upload a screenshot to request verification'); return;
    }

    setSaving(true);
    try {
      const { data: row, error } = await supabase
        .from('platform_history')
        .upsert({
          user_id: user.id,
          platform: platformName,
          role: form.role || null,
          rating: form.rating,
          verification_status: form.requestVerification ? 'pending' : 'unverified',
          rejection_reason: null,
          reviewed_by: null,
          reviewed_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform' })
        .select()
        .single();

      if (error) throw error;

      if (form.requestVerification && form.evidenceFile && row) {
        const ext = form.evidenceFile.name.split('.').pop() || 'png';
        const filePath = `${user.id}/${row.id}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('platform-evidence')
          .upload(filePath, form.evidenceFile, { contentType: form.evidenceFile.type, upsert: true });
        if (uploadErr) {
          console.warn('[PlatformHistoryPanel] evidence upload failed:', uploadErr);
          toast.error('Entry saved, but the screenshot upload failed: ' + uploadErr.message);
        } else {
          const { error: linkErr } = await supabase
            .from('platform_history')
            .update({ evidence_url: filePath })
            .eq('id', row.id);
          if (linkErr) {
            console.warn('[PlatformHistoryPanel] failed to link evidence_url:', linkErr);
            toast.error('Screenshot uploaded, but could not be linked to your entry: ' + linkErr.message);
          }
        }
      }

      toast.success(`${platformName} saved`);
      setForm(emptyForm);
      setShowForm(false);
      fetchEntries();
    } catch (err) {
      toast.error('Could not save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry) => {
    setDeletingId(entry.id);
    const { error } = await supabase.from('platform_history').delete().eq('id', entry.id);
    if (error) {
      toast.error('Could not remove: ' + error.message);
    } else {
      toast.success(`${entry.platform} removed`);
      setEntries(prev => prev.filter(e => e.id !== entry.id));
    }
    setDeletingId(null);
  };

  const statusBadge = (status) => {
    if (status === 'verified') return <span className="text-[10px] text-green-600 font-medium">✅ Verified</span>;
    if (status === 'pending')  return <span className="text-[10px] text-amber-600 font-medium">⏳ Pending review</span>;
    if (status === 'rejected') return <span className="text-[10px] text-destructive font-medium">❌ Rejected</span>;
    return <span className="text-[10px] text-muted-foreground">Self-reported</span>;
  };

  // Pre-fills the add/edit form from a rejected entry so the driver can
  // correct and resubmit rather than starting from scratch.
  const openResubmitForm = (entry) => {
    const isKnownPlatform = PLATFORM_OPTIONS.includes(entry.platform);
    setForm({
      platform: isKnownPlatform ? entry.platform : 'Other',
      otherPlatform: isKnownPlatform ? '' : entry.platform,
      role: entry.role || '',
      rating: Number(entry.rating) || 0,
      evidenceFile: null,
      requestVerification: true,
    });
    setShowForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add your rating history from other platforms like Uber or Bolt — this helps owners trust you faster when you send a rental proposal.
      </p>

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(entry => (
            <Card key={entry.id} className="p-4 border border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{entry.platform}</span>
                    {entry.role && <span className="text-xs text-muted-foreground">· {entry.role}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="flex items-center gap-0.5 text-amber-500 text-xs font-semibold">
                      <Star className="w-3.5 h-3.5 fill-current" /> {Number(entry.rating).toFixed(1)}
                    </span>
                    {statusBadge(entry.verification_status)}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(entry)}
                  disabled={deletingId === entry.id}
                  className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  {deletingId === entry.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>

              {entry.verification_status === 'rejected' && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <p className="text-xs text-destructive">
                    <span className="font-semibold">Rejected:</span> {entry.rejection_reason || 'No reason given.'}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => openResubmitForm(entry)} className="w-full gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Correct & Resubmit
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {!showForm ? (
        <Button variant="outline" onClick={() => setShowForm(true)} className="w-full gap-2">
          <Plus className="w-4 h-4" /> Add a Platform
        </Button>
      ) : (
        <Card className="p-4 border border-border/50 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Add Platform</p>
            <button onClick={() => { setShowForm(false); setForm(emptyForm); }} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <Label className="text-xs font-medium">Platform</Label>
            <Select value={form.platform} onValueChange={v => setForm(p => ({ ...p, platform: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a platform" /></SelectTrigger>
              <SelectContent>
                {PLATFORM_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {form.platform === 'Other' && (
            <div>
              <Label className="text-xs font-medium">Platform Name</Label>
              <Input className="mt-1" placeholder="e.g. DiDi" value={form.otherPlatform} onChange={e => setForm(p => ({ ...p, otherPlatform: e.target.value }))} />
            </div>
          )}

          <div>
            <Label className="text-xs font-medium">Your Rating</Label>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setForm(p => ({ ...p, rating: n }))}>
                  <Star className={`w-7 h-7 ${n <= form.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium">Role (optional)</Label>
            <Input className="mt-1" placeholder="e.g. Driver, Courier" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.requestVerification}
              onChange={e => setForm(p => ({ ...p, requestVerification: e.target.checked }))}
            />
            Request verification (free — reviewed manually by our team)
          </label>

          {form.requestVerification && (
            <div>
              <Label className="text-xs font-medium">Upload a screenshot of your rating</Label>
              <label className="mt-1 flex items-center gap-2 border border-dashed border-border rounded-xl p-3 cursor-pointer hover:border-primary/40 transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => setForm(p => ({ ...p, evidenceFile: e.target.files[0] || null }))}
                />
                <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {form.evidenceFile ? form.evidenceFile.name : 'Tap to choose an image'}
                </span>
              </label>
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save Platform'}
          </Button>
        </Card>
      )}
    </div>
  );
}
