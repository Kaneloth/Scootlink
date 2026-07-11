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
  const [targetType, setTargetType] = useState('all');
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]); // [{id, full_name, email}]

  useEffect(() => {
    if (targetType !== 'specific' || !userSearch.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .or(`full_name.ilike.%${userSearch.trim()}%,email.ilike.%${userSearch.trim()}%`)
        .limit(8);
      setSearchResults((data || []).filter(u => !selectedUsers.some(s => s.id === u.id)));
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [userSearch, targetType, selectedUsers]);

  const addRecipient = (u) => {
    setSelectedUsers(prev => [...prev, u]);
    setUserSearch('');
    setSearchResults([]);
  };
  const removeRecipient = (id) => setSelectedUsers(prev => prev.filter(u => u.id !== id));

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
    if (targetType === 'specific' && selectedUsers.length === 0) { toast.error('Pick at least one user, or switch to All Users.'); return; }
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inserted, error } = await supabase.from('announcements').insert({
      title: title.trim(),
      body: body.trim(),
      severity,
      is_active: true,
      target_type: targetType,
      created_by: user?.id || null,
    }).select('id').single();

    if (error) {
      toast.error('Could not create: ' + error.message);
      setCreating(false);
      return;
    }

    if (targetType === 'specific') {
      const rows = selectedUsers.map(u => ({ announcement_id: inserted.id, user_id: u.id }));
      const { error: recErr } = await supabase.from('announcement_recipients').insert(rows);
      if (recErr) {
        toast.error('Announcement created, but failed to set recipients: ' + recErr.message);
        setCreating(false);
        return;
      }
    }

    toast.success(targetType === 'all' ? 'Announcement posted to all users' : `Announcement sent to ${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''}`);
    setTitle(''); setBody(''); setSeverity('info'); setTargetType('all'); setSelectedUsers([]);
    fetchAnnouncements();
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

        <div>
          <p className="text-xs font-medium mb-1.5">Send to</p>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setTargetType('all')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${targetType === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
            >
              All Users
            </button>
            <button
              onClick={() => setTargetType('specific')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${targetType === 'specific' ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}
            >
              Specific Users
            </button>
          </div>

          {targetType === 'specific' && (
            <div>
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedUsers.map(u => (
                    <span key={u.id} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                      {u.full_name || u.email}
                      <button onClick={() => removeRecipient(u.id)} className="hover:text-destructive">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <input
                  placeholder="Search by name or email…"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                />
                {(searching || searchResults.length > 0) && userSearch.trim() && (
                  <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {searching ? (
                      <div className="p-2 text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Searching…</div>
                    ) : searchResults.length === 0 ? (
                      <div className="p-2 text-xs text-muted-foreground">No matches</div>
                    ) : searchResults.map(u => (
                      <button
                        key={u.id}
                        onClick={() => addRecipient(u)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors"
                      >
                        <p className="font-medium">{u.full_name || 'Unnamed'}</p>
                        <p className="text-muted-foreground">{u.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

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
                  {a.target_type === 'specific' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium shrink-0">Targeted</span>
                  )}
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
