import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, NavLink } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import {
  LayoutDashboard, Users, FileText, LogOut, ArrowLeft, Menu, Shield, X,
  Loader2, Star, Coins, ShieldCheck, Flag, Megaphone, Bell, Radar, Banknote,
} from 'lucide-react';

// Grouped the same way Crosssa's admin dashboard does — a flat 10-item list
// was getting hard to scan. Categories chosen to match what an admin is
// actually trying to do in the moment (find a user vs. handle money vs.
// send a message to everyone), not just alphabetical or by data table.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { path: '/admin', icon: LayoutDashboard, label: 'Overview', end: true },
    ],
  },
  {
    label: 'People',
    items: [
      { path: '/admin/users',                 icon: Users,       label: 'Users' },
      { path: '/admin/identity-verification', icon: ShieldCheck, label: 'Identity Verification' },
      { path: '/admin/platform-verification', icon: Star,        label: 'Platform Verification' },
    ],
  },
  {
    label: 'Rentals & Money',
    items: [
      { path: '/admin/rentals',          icon: FileText,  label: 'Rentals' },
      { path: '/admin/credit-grants',    icon: Coins,     label: 'Signup Credit Grants' },
      { path: '/admin/refund-requests',  icon: Banknote,  label: 'Refund Requests' },
    ],
  },
  {
    label: 'Trust & Safety',
    items: [
      { path: '/admin/disputes', icon: Flag, label: 'Disputes Center' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { path: '/admin/announcements',    icon: Megaphone, label: 'Announcements' },
      { path: '/admin/reminders',        icon: Bell,      label: 'Automated Reminders' },
      { path: '/admin/proximity-alerts', icon: Radar,     label: 'Proximity Alerts' },
    ],
  },
];

function SidebarContent({ onNavigate, onLogout }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary shrink-0" />
          <span className="font-bold text-lg">Admin</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ path, icon: Icon, label, end }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-border space-y-0.5">
        <NavLink
          to="/home"
          onClick={onNavigate}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          Back to App
        </NavLink>
        <button
          onClick={onLogout}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 w-full transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Logout
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Gate on profiles.is_admin (surfaced in the JWT's user_metadata), matching
  // how the rest of the app already checks admin status — no hardcoded email
  // list here, so granting a second admin is just flipping a column.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth', { replace: true });
        return;
      }
      if (user.user_metadata?.is_admin !== true) {
        navigate('/home', { replace: true });
        return;
      }
      setIsAdmin(true);
      setChecking(false);
    })();
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  if (checking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar — fixed, always visible on lg+. A completely
          separate render path from the mobile version below, rather than
          one shared element toggled with a CSS transform — avoids any
          transform/positioning edge cases getting in the way of it simply
          showing up when it's supposed to. */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-card">
        <div className="sticky top-0 h-screen">
          <SidebarContent onLogout={handleLogout} />
        </div>
      </aside>

      {/* Mobile sidebar — slide-over, only rendered at all while open */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[80vw] bg-card border-r border-border">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} onLogout={handleLogout} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-40 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5 text-foreground" />
          </button>
          <p className="text-sm font-bold text-foreground">Skootlink Admin</p>
        </div>

        {/* Desktop header — unchanged from before */}
        <header className="hidden lg:flex items-center justify-between p-4 border-b border-border bg-card sticky top-0 z-30">
          <span className="text-sm text-muted-foreground">Admin Dashboard — Skootlink</span>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
