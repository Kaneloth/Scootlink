// src/components/home/HomeTopBar.jsx
//
// Top of every Home screen. Replaces the app-wide header bar (logo + bell +
// account menu) that sat above every page: Home now carries the greeting,
// the user's current area, notifications and the account menu, and other
// pages keep only their own title bar. Stays pinned while the page scrolls
// under it (pull down anywhere on the page to refresh — see PullToRefresh).

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Settings, LogOut, LifeBuoy, MapPin } from 'lucide-react';
import NotificationBell from '@/components/layout/NotificationBell';
import { logout } from '@/lib/logout';
import useCurrentPlace from '@/hooks/useCurrentPlace';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomeTopBar({ user }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close, { passive: true });
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [open]);

  const first = user?.full_name?.trim().split(' ')[0];
  const go = (path) => { setOpen(false); navigate(path); };
  const place = useCurrentPlace(user?.location);

  return (
    <div className="sticky top-0 z-30 -mx-4 -mt-4 px-4 pt-4 pb-3 mb-4 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-8 bg-background/95 backdrop-blur border-b border-border/60 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{greeting()}</p>
        <h1 className="text-2xl font-bold text-foreground tracking-tight truncate">{first || 'Welcome'}</h1>
        <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
          <MapPin className={`w-3.5 h-3.5 shrink-0 ${place.isLive ? 'text-primary' : ''}`} />
          <span className="truncate">{place.label || (place.locating ? 'Finding your location…' : 'Location unavailable')}</span>
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <NotificationBell />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className={`w-11 h-11 rounded-full overflow-hidden flex items-center justify-center border-2 transition-colors ${open ? 'border-primary' : 'border-border hover:border-primary/50'} bg-muted text-muted-foreground`}
            style={{ touchAction: 'manipulation' }}
            aria-label="Account menu"
          >
            {user?.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              : <User className="w-5 h-5" />}
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card shadow-lg overflow-hidden z-50">
              <MenuItem icon={User} label="Profile" onClick={() => go('/profile')} />
              <MenuItem icon={Settings} label="Settings" onClick={() => go('/settings')} />
              <MenuItem icon={LifeBuoy} label="Help & contact" onClick={() => go('/contact')} />
              <div className="border-t border-border" />
              <button
                onClick={async () => { setOpen(false); await logout(navigate); }}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-destructive/10 text-destructive transition-colors text-left"
              >
                <LogOut className="w-4 h-4" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-left">
      <Icon className="w-4 h-4 text-muted-foreground" /> {label}
    </button>
  );
}
