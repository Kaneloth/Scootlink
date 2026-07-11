import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Megaphone, Trash2, Plus, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const SEVERITIES = [
  { value: 'info', label: 'Info (blue)' },
  { value: 'warning', label: 'Warning (amber)' },
  { value: 'success', label: 'Success (green)' },
];

export default function AdminAnnouncements() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [processingId, setProcessingId] = useState(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('info');

  const fetchAnnouncements = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error('Could not load announcements: ' + error.message);
    setAnnouncements(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAnnouncements(); }, []);

  const createAnnouncement = async () => {
    if (!title.trim() || !body.trim()) { toast.error('Title and message are both required.'); return; }
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('announcements').insert({
      title: title.trim(),
      body: body.trim(),
      severity,
      is_active: true,
      created_by: user?.id || null,
    });
    if (error) {
      toast.error('Could not create: ' + error.message);
    } else {
      toast.success('Announcement posted');
      setTitle(''); setBody(''); setSeverity('info');
      fetchAnnouncements();
    }
    setCreating(false);
  };

  const toggleActive = async (a) => {
    setProcessingId(a.id);
    const { error } = await supabase.from('announcements').update({ is_active: !a.is_active }).eq('id', a.id);
    if (error) toast.error('Failed: ' + error.message);
    else setAnnouncements(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x));
    setProcessingId(null);
  };

  const deleteAnnouncement = async (a) => {
    setProcessingId(a.id);
    const { error } = await supabase.from('announcements').delete().eq('id', a.id);
    if (error) toast.error('Failed: ' + error.message);
    else {
      toast.success('Deleted');
      setAnnouncements(prev => prev.filter(x => x.id !== a.id));
    }
    setProcessingId(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2"><Megaphone className="w-5 h-5" /> Announcements</h2>
        <p className="text-sm text-muted-foreground">Shown as a dismissible banner on the Dashboard for every user who hasn't dismissed it.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold">New Announcement</p>
        <input
          placeholder="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
        />
        <textarea
          placeholder="Message"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={3}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none"
        />
        <select
          value={severity}
          onChange={e => setSeverity(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm bg-background"
        >
          {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button
          onClick={createAnnouncement}
          disabled={creating}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Post Announcement
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : announcements.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">No announcements yet.</p>
      ) : (
        <div className="space-y-2">
          {announcements.map(a => (
            <div key={a.id} className="bg-card border border-border rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{a.title}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                    a.is_active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
                  }`}>
                    {a.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{a.severity}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{a.body}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString('en-ZA')}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  disabled={processingId === a.id}
                  onClick={() => toggleActive(a)}
                  className="p-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-60"
                  title={a.is_active ? 'Deactivate' : 'Activate'}
                >
                  {a.is_active ? <XCircle className="w-3.5 h-3.5 text-muted-foreground" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
                </button>
                <button
                  disabled={processingId === a.id}
                  onClick={() => deleteAnnouncement(a)}
                  className="p-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
