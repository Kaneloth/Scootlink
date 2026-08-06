/**
 * NotificationBell — in-app notification bell for the mobile header.
 * Replaces the CreditBalance chip.
 * Place at: src/components/layout/NotificationBell.jsx
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen]                   = useState(false);
  const [userId, setUserId]               = useState(null);
  const panelRef                          = useRef(null);
  const navigate                          = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, read, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    // Same info already lives on the Activity page — once something's been
    // read here, there's no reason to keep it cluttering this dropdown
    // indefinitely. Give it a day's grace period after being read, then
    // drop it from view (the underlying row is untouched, just hidden here).
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const visible = (data || []).filter(n =>
      !n.read || !n.read_at || new Date(n.read_at).getTime() > dayAgo
    );

    setNotifications(visible);
  }, [userId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('notification-bell')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications',
        filter: `user_id=eq.${userId}`,
      }, () => fetchNotifications())
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'notifications',
        filter: `user_id=eq.${userId}`,
      }, () => fetchNotifications())
      .subscribe();

    const poll = setInterval(fetchNotifications, 30_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [userId, fetchNotifications]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = async () => {
    setOpen(v => !v);
    const unread = notifications.filter(n => !n.read).map(n => n.id);
    if (unread.length > 0) {
      const now = new Date().toISOString();
      await supabase
        .from('notifications')
        .update({ read: true, read_at: now })
        .in('id', unread);
      setNotifications(prev => prev.map(n => unread.includes(n.id) ? { ...n, read: true, read_at: now } : n));
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const formatTime = (ts) => {
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  };

  const iconForType = (type) => {
    switch (type) {
      case 'rental_contract': return '📄';
      case 'rental_accepted': return '✅';
      case 'rental_active':   return '🚀';
      case 'rental_ended':    return '🏁';
      default:                return '🔔';
    }
  };

  return (
    <div className="relative flex-shrink-0" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative w-10 h-10 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Notifications"
        style={{ touchAction: 'manipulation' }}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed top-16 right-4 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card shadow-xl z-[999] overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {notifications.length > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
                onClick={async () => {
                  const now = new Date().toISOString();
                  await supabase
                    .from('notifications')
                    .update({ read: true, read_at: now })
                    .eq('user_id', userId)
                    .eq('read', false);
                  setNotifications(prev => prev.map(n => n.read ? n : { ...n, read: true, read_at: now }));
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl mb-2">🔔</p>
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`px-4 py-3 flex items-start gap-3 ${!n.read ? 'bg-primary/5' : ''}`}
                >
                  <span className="text-lg shrink-0 mt-0.5">{iconForType(n.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium text-foreground leading-snug ${!n.read ? 'font-semibold' : ''}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{formatTime(n.created_at)}</p>
                    {['listing_expiry_7d','listing_expiry_3d','listing_expiry_1d','listing_expired','listing_hidden'].includes(n.type) && n.data?.vehicle_id && (
                      <button
                        onClick={() => {
                          setOpen(false);
                          navigate(`/edit-vehicle?id=${n.data.vehicle_id}&relist=1`);
                        }}
                        className="mt-2 text-[11px] font-semibold text-primary hover:underline"
                      >
                        Re-list now →
                      </button>
                    )}
                  </div>
                  {!n.read && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
