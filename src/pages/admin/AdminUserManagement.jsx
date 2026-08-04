import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Shield, ShieldOff, User, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

async function callAdminAppSettings(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch('https://skootlink.co.za/.netlify/functions/admin-app-settings', {
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

function ProfileVisibilitySettingCard() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await callAdminAppSettings('get');
        setEnabled(data.profile_visibility_toggle_enabled === true);
      } catch (err) {
        toast.error('Could not load setting: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const data = await callAdminAppSettings('toggle_profile_visibility', { enabled: !enabled });
      setEnabled(data.profile_visibility_toggle_enabled);
      toast.success(
        data.profile_visibility_toggle_enabled
          ? 'Profile visibility control is now available to all users.'
          : 'Profile visibility control is now hidden from all users.'
      );
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card className="p-4 mb-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {enabled ? <Eye className="w-5 h-5 text-primary shrink-0" /> : <EyeOff className="w-5 h-5 text-muted-foreground shrink-0" />}
          <div>
            <p className="text-sm font-semibold text-foreground">Profile Visibility Control</p>
            <p className="text-xs text-muted-foreground">
              {loading
                ? 'Loading…'
                : enabled
                  ? 'Users can currently hide their profile from search. Turn off to prevent everyone from going incognito.'
                  : 'Hidden from all users — no one can go incognito right now. Turn on once user numbers are high enough that this is low-risk.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={loading || toggling}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60 ${enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>
    </Card>
  );
}

export default function AdminUserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actioningId, setActioningId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, email, account_type, blacklisted, id_verified, licence_verified, created_at')
          .order('created_at', { ascending: false });
        setUsers(data || []);
      } catch (err) {
        toast.error('Failed to load users: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredUsers = users.filter(u =>
    !search ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleBlacklist = async (user) => {
    setActioningId(user.id);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ blacklisted: !user.blacklisted })
        .eq('id', user.id);
      if (error) throw error;
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, blacklisted: !u.blacklisted } : u));
      toast.success(user.blacklisted ? 'User unbanned.' : 'User banned.');
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Users</h2>
        <p className="text-sm text-muted-foreground">Manage user accounts and platform-wide settings.</p>
      </div>

      <ProfileVisibilitySettingCard />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map(u => (
            <Card key={u.id} className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary/50" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{u.full_name || 'Unnamed'}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className={`shrink-0 gap-1.5 ${u.blacklisted ? '' : 'text-destructive border-destructive/40 hover:bg-destructive/10'}`}
                disabled={actioningId === u.id}
                onClick={() => toggleBlacklist(u)}
              >
                {actioningId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : u.blacklisted ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                {u.blacklisted ? 'Unban' : 'Ban'}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
