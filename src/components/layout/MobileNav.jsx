import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Search, MapPin, Wallet, Settings, MessageCircle } from 'lucide-react';
import { auth, supabase } from '@/api/supabaseData';

const baseItems = [
  { label: 'Home',     icon: LayoutDashboard, path: '/'                },
  { label: 'Search',   icon: Search,          path: '/search-vehicles' },
  { label: 'Messages', icon: MessageCircle,   path: '/messages'        },
  { label: 'Track',    icon: MapPin,          path: '/tracking'        },
  { label: 'Wallet',   icon: Wallet,          path: '/wallet'          },
  { label: 'Settings', icon: Settings,        path: '/settings'        },
];

export default function MobileNav() {
  const location = useLocation();
  const [accountType, setAccountType]   = useState('driver');
  const [unreadCount, setUnreadCount]   = useState(0);
  const userIdRef                        = useRef(null);

  // ── Resolve account type ───────────────────────────────────────────────────
  useEffect(() => {
    auth.me().then(user => {
      setAccountType(user?.subscription_plan || 'driver');
      userIdRef.current = user?.id ?? null;
      if (user?.id) fetchUnreadCount(user.id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const plan = session.user.user_metadata?.subscription_plan;
        if (plan) setAccountType(plan);
        userIdRef.current = session.user.id;
        fetchUnreadCount(session.user.id);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  // ── Unread count: initial fetch ────────────────────────────────────────────
  const fetchUnreadCount = async (userId) => {
    if (!userId) return;
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', userId)
      .eq('read', false);
    if (!error) setUnreadCount(count ?? 0);
  };

  // ── Unread count: realtime subscription ───────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('unread-messages-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => {
          if (userIdRef.current) fetchUnreadCount(userIdRef.current);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // ── Re-fetch when navigating away from /messages (marks as read there) ────
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
          const isActive   = location.pathname === item.path;
          const showBadge  = item.label === 'Messages' && unreadCount > 0;

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
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
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
