/**
 * NotificationBell — in-app notification bell for the mobile header.
 * Replaces the CreditBalance chip.
 * Place at: src/components/layout/NotificationBell.jsx
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen]                   = useState(false);
  const [userId, setUserId]               = useState(null);
  const panelRef                          = useRef(null);

  // ── Fetch user id once ────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  // ── Fetch notifications ───────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifications(data || []);
  }, [userId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // ── Realtime: push new notifications live ────────────────────────────────
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

    return () => supabase.removeChannel(channel);
  }, [userId, fetchNotifications]);

  // ── Close on outside click ────────────────────────────────────────────────
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

  // ── Mark all as read when panel opens ────────────────────────────────────
  const handleOpen = async () => {
    setOpen(v => !v);
    const unread = notifications.filter(n => !n.read).map(n => n.id);
    if (unread.length > 0) {
      await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', unread);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
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
      {/* Bell button */}
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

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute mt-2 rounded-2xl border border-border bg-card shadow-xl z-50 overflow-hidden"
          style={{
            right: 0,
            width: '320px',
            maxWidth: 'calc(100vw - 1rem)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {notifications.length > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
                onClick={async () => {
                  await supabase.from('notifications').update({ read: true }).eq('user_id', userId);
                  setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
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
