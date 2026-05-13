import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Search, MapPin, Wallet, Settings, MessageCircle } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

const baseItems = [
  { label: 'Home',     icon: LayoutDashboard, path: '/'                },
  { label: 'Search',   icon: Search,          path: '/search-vehicles' },
  { label: 'Messages', icon: MessageCircle,   path: '/messages'        },
  { label: 'Track',    icon: MapPin,          path: '/tracking'        },
  { label: 'Wallet',   icon: Wallet,          path: '/wallet'          },
  { label: 'Settings', icon: Settings,        path: '/settings'        },
];

export default function MobileNav() {
  const location                          = useLocation();
  const [accountType, setAccountType]     = useState('driver');
  const [unreadCount, setUnreadCount]     = useState(0);
  const userIdRef                          = useRef(null);

  // ── Resolve user ID and account type from Supabase auth directly ──────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      userIdRef.current = user.id;
      const plan = user.user_metadata?.subscription_plan;
      if (plan) setAccountType(plan);
      fetchUnreadCount(user.id);
    });
  }, []);

  // Keep account type in sync with auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        userIdRef.current = session.user.id;
        const plan = session.user.user_metadata?.subscription_plan;
        if (plan) setAccountType(plan);
        fetchUnreadCount(session.user.id);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  // ── Unread count fetch ────────────────────────────────────────────────────
  const fetchUnreadCount = async (userId) => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .eq('receiver_id', userId)
      .eq('read', false);
    if (!error) setUnreadCount(data?.length ?? 0);
  };

  // ── Realtime: refresh count on any message change ────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('mobilenav-unread-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        if (userIdRef.current) fetchUnreadCount(userIdRef.current);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => {
        if (userIdRef.current) fetchUnreadCount(userIdRef.current);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, () => {
        if (userIdRef.current) fetchUnreadCount(userIdRef.current);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // ── Polling fallback: refresh every 20 s in case realtime is unavailable ──
  useEffect(() => {
    const interval = setInterval(() => {
      if (userIdRef.current) fetchUnreadCount(userIdRef.current);
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  // ── Re-fetch whenever route changes (opening /messages marks as read) ─────
  useEffect(() => {
    if (userIdRef.current) fetchUnreadCount(userIdRef.current);
  }, [location.pathname]);

  const searchPath =
    accountType === 'owner' ? '/find-drivers' :
    accountType === 'both'  ? '/mysearch'     :
    '/search-vehicles';

  const navItems = baseItems.map(item =>
    item.label === 'Search' ? { ...item, path: searchPath } : item
  );

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-lg border-t border-border z-50 safe-area-bottom">
      <div className="flex justify-around items-center py-2 px-2">
        {navItems.map((item) => {
          const isActive  = location.pathname === item.path;
          const showBadge = item.label === 'Messages' && unreadCount > 0;

          return (
            <Link
              key={item.label + item.path}
              to={item.path}
              className={`relative flex flex-col items-center gap-0.5 py-1 px-3 rounded-xl transition-all duration-200 ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <span className="relative">
                <item.icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
