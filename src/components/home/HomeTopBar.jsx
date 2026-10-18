// src/components/home/HomeTopBar.jsx
//
// Top of every Home screen. Replaces the app-wide header bar (logo + bell +
// account menu) that sat above every page: Home now carries the greeting,
// notifications and the account menu, and other pages keep only their own
// title bar.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Settings, LogOut, LifeBuoy, RefreshCw } from 'lucide-react';
import NotificationBell from '@/components/layout/NotificationBell';
import { logout } from '@/lib/logout';

const ROLE_LINE = {
  customer: 'Where are you going today?',
  driver: 'Ready to drive?',
  owner: 'Your vehicles at a glance',
  both: 'Your vehicles and drives',
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomeTopBar({ user, role, onRefresh, refreshing = false }) {
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

  return (
    <div className="flex items-center justify-between gap-3 mb-5">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{greeting()}</p>
        <h1 className="text-2xl font-bold text-foreground tracking-tight truncate">{first || 'Welcome'}</h1>
        <p className="text-sm text-muted-foreground truncate">{ROLE_LINE[role] || ROLE_LINE.both}</p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onRefresh && (
          <button onClick={onRefresh} className="p-2 rounded-full hover:bg-muted transition-colors" aria-label="Refresh">
            <RefreshCw className={`w-4 h-4 text-primary ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        )}
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
