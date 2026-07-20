import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Bell, Trash2, Plus, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const SEVERITIES = [
  { value: 'info', label: 'Info (blue)' },
  { value: 'warning', label: 'Warning (amber)' },
  { value: 'success', label: 'Success (green)' },
];

const CONDITIONS = [
  { value: 'profile_incomplete', label: 'Profile incomplete (missing name/phone/location)' },
  { value: 'not_verified', label: 'Not verified (no ID or licence verification)' },
  { value: 'no_vehicle_listed', label: 'Owner with no vehicle listed' },
];

export default function AdminReminders() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [processingId, setProcessingId] = useState(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('info');
  const [conditionType, setConditionType] = useState('profile_incomplete');

  const fetchRules = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('reminder_rules').select('*').order('created_at', { ascending: false });
    if (error) toast.error('Could not load reminders: ' + error.message);
    setRules(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchRules(); }, []);

  const createRule = async () => {
    if (!title.trim() || !body.trim()) { toast.error('Title and message are both required.'); return; }
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('reminder_rules').insert({
      title: title.trim(),
      body: body.trim(),
      severity,
      condition_type: conditionType,
      is_active: false,
      created_by: user?.id || null,
    });
    if (error) {
      toast.error('Could not create: ' + error.message);
    } else {
      toast.success('Reminder rule created — tap the checkmark to activate it once you\'re ready.');
      setTitle(''); setBody(''); setSeverity('info'); setConditionType('profile_incomplete');
      fetchRules();
    }
    setCreating(false);
  };

  const toggleActive = async (r) => {
    setProcessingId(r.id);
    const { error } = await supabase.from('reminder_rules').update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) toast.error('Failed: ' + error.message);
    else setRules(prev => prev.map(x => x.id === r.id ? { ...x, is_active: !x.is_active } : x));
    setProcessingId(null);
  };

  const deleteRule = async (r) => {
    setProcessingId(r.id);
    const { error } = await supabase.from('reminder_rules').delete().eq('id', r.id);
    if (error) toast.error('Failed: ' + error.message);
    else {
      toast.success('Deleted');
      setRules(prev => prev.filter(x => x.id !== r.id));
    }
    setProcessingId(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2"><Bell className="w-5 h-5" /> Automated Reminders</h2>
        <p className="text-sm text-muted-foreground">Shown automatically on the Dashboard for any user matching the condition — no manual sending needed.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold">New Reminder Rule</p>
        <div>
          <p className="text-xs font-medium mb-1">Trigger condition</p>
          <select
            value={conditionType}
            onChange={e => setConditionType(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
          >
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
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
          onClick={createRule}
          disabled={creating}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Create Rule
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : rules.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-xl">No reminder rules yet.</p>
      ) : (
        <div className="space-y-2">
          {rules.map(r => (
            <div key={r.id} className="bg-card border border-border rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold truncate">{r.title}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                    r.is_active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
                  }`}>
                    {r.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium shrink-0">
                    {CONDITIONS.find(c => c.value === r.condition_type)?.label || r.condition_type}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{r.body}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{new Date(r.created_at).toLocaleString('en-ZA')}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  disabled={processingId === r.id}
                  onClick={() => toggleActive(r)}
                  className="p-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-60"
                  title={r.is_active ? 'Deactivate' : 'Activate'}
                >
                  {r.is_active ? <XCircle className="w-3.5 h-3.5 text-muted-foreground" /> : <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
                </button>
                <button
                  disabled={processingId === r.id}
                  onClick={() => deleteRule(r)}
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
