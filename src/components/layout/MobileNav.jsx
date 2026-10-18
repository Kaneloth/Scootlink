import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Search, Clock, Briefcase } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import useRentalUnread from '@/hooks/useRentalUnread';

const baseItems = [
  { label: 'Home',     icon: LayoutDashboard, path: '/home'            },
  { label: 'Search',   icon: Search,          path: '/search-vehicles' },
  { label: 'Activity',  icon: Clock,           path: '/activity'        },
  { icon: Briefcase, label: 'Briefcase', path: '/briefcase' },
];

export default function MobileNav() {
  const location                          = useLocation();
  const [accountType, setAccountType]     = useState('driver');
  const [userId, setUserId]               = useState(null);

  // ── Resolve user ID and account type from Supabase auth directly ──────────
  // Resolve effective account type from profile
  const resolveAccountType = (userMeta) => {
    return userMeta?.account_type || 'both';
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      setAccountType(resolveAccountType(user.user_metadata));
    });
  }, []);

  // Keep account type in sync with auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserId(session.user.id);
        setAccountType(resolveAccountType(session.user.user_metadata));
      } else {
        setUserId(null);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  // ── Unread chat badge on Home ─────────────────────────────────────────────
  // There is no inbox: rental chats open from their rental card on Home, so
  // the unread count for rental chats sits on the Home tab. Gig chats show
  // their own count on the trip screen.
  const { total: unreadCount } = useRentalUnread(userId);

  const searchPath =
    accountType === 'owner' ? '/find-drivers' :
    accountType === 'both'  ? '/mysearch'     :
    '/search-vehicles';

  const navItems = baseItems.map(item =>
    item.label === 'Search' ? { ...item, path: searchPath } : item
  );

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-lg border-t border-border z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex justify-around items-center py-2 px-2">
        {navItems.map((item) => {
          const isActive  = location.pathname === item.path;
          const showBadge = item.label === 'Home' && unreadCount > 0;

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
