import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike, User, Settings, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase, saveBiometricRefreshToken } from '@/api/supabaseData';

// ─── Temporary dummy page components (replace with real imports later) ────
import HomePage from '@/pages/Dashboard';
import SearchPage from '@/pages/SearchPage';
import TrackingPage from '@/pages/Tracking';
const BriefcasePage = () => <div style={{ padding: 20 }}>Briefcase Page</div>;
const MessagesPage = () => <div style={{ padding: 20 }}>Messages Page</div>;

const TAB_ORDER = ['/', '/search-vehicles', '/tracking', '/briefcase', '/messages'];

const TABS = [
  { path: '/',               component: HomePage,      icon: Bike, label: 'Home' },
  { path: '/search-vehicles', component: SearchPage,    icon: Bike, label: 'Search' },
  { path: '/tracking',       component: TrackingPage,   icon: Bike, label: 'Track' },
  { path: '/briefcase',      component: BriefcasePage,  icon: Bike, label: 'Briefcase' },
  { path: '/messages',       component: MessagesPage,   icon: Bike, label: 'Messages' },
];

const TAB_PATHS = TABS.map(t => t.path);
const THRESHOLD = 0.3;

// ─── Navigation progress bar (from original) ────────────────────────────
function useNavigationProgress(pathname) {
  const [barState, setBarState] = useState({ width: 0, visible: false, done: false });
  const prevPathRef = useRef(pathname);
  const timersRef = useRef([]);
  const clear = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    clear();
    setBarState({ width: 0, visible: true, done: false });
    const t1 = setTimeout(() => setBarState(s => ({ ...s, width: 60 })), 30);
    const t2 = setTimeout(() => setBarState(s => ({ ...s, width: 80 })), 250);
    const t3 = setTimeout(() => setBarState(s => ({ ...s, width: 95 })), 500);
    const t4 = setTimeout(() => setBarState(s => ({ ...s, width: 100, done: true })), 700);
    const t5 = setTimeout(() => setBarState({ width: 0, visible: false, done: false }), 1050);
    timersRef.current = [t1, t2, t3, t4, t5];
    return clear;
  }, [pathname]);

  return barState;
}

function NavigationProgressBar({ pathname }) {
  const { width, visible, done } = useNavigationProgress(pathname);
  if (!visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-[3px] pointer-events-none">
      <div style={{
        height: '100%', width: `${width}%`,
        transition: width === 0 ? 'none' : done
          ? 'width 0.2s ease-in, opacity 0.3s ease-out 0.05s'
          : 'width 0.4s ease-out',
        opacity: done ? 0 : 1,
        background: 'hsl(var(--primary))',
        boxShadow: '0 0 8px hsl(var(--primary) / 0.6)',
        borderRadius: '0 2px 2px 0',
      }} />
    </div>
  );
}

// ─── Verification gate (from original) ──────────────────────────────────
const GATE_EXEMPT = ['/onboarding', '/subscription', '/settings', '/profile'];
const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];

function VerificationGate({ user, userLoading, children }) {
  const location = useLocation();
  const navigate  = useNavigate();

  if (userLoading) return null;
  if (!user) return children;

  const isAdmin   = ADMIN_EMAILS.includes(user.email);
  const isExempt  = GATE_EXEMPT.some((p) => location.pathname.startsWith(p));
  if (isAdmin || isExempt) return children;

  if (!user.onboarding_completed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2">Complete your profile first</h2>
          <p className="text-muted-foreground text-sm max-w-xs">
            Identity verification is required before you can access Skootlink features.
          </p>
        </div>
        <button
          className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors"
          onClick={() => navigate('/onboarding')}
        >
          Set up my profile
        </button>
      </div>
    );
  }

  return children;
}

// ─── Shared biometric-aware logout (from original) ──────────────────────
async function layoutLogout(navigate) {
  if (localStorage.getItem('scootlink_signin_method') === 'biometric') {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session) saveBiometricRefreshToken(data.session);
    } catch { /* non-fatal */ }
    navigate('/auth');
  } else {
    await supabase.auth.signOut();
    navigate('/auth');
  }
}

// ─── Mobile header with profile dropdown (from original) ────────────────
function MobileHeader() {
  const navigate               = useNavigate();
  const [open, setOpen]        = useState(false);
  const dropdownRef            = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    await layoutLogout(navigate);
  };

  return (
    <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card z-30 shrink-0">
      <Link to="/" className="flex items-center gap-2">
        <img src="/favicon.png" alt="Skootlink" className="w-8 h-8" />
        <span className="text-base font-bold text-foreground">Skootlink</span>
      </Link>

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(v => !v)}
          className={`w-11 h-11 rounded-full flex items-center justify-center border-2 transition-colors ${open ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
          style={{ touchAction: 'manipulation' }}
          aria-label="Account menu"
        >
          <User className="w-5 h-5" />
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border bg-card shadow-lg overflow-hidden z-50">
            <button
              onClick={() => { setOpen(false); navigate('/profile'); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-left"
            >
              <User className="w-4 h-4 text-muted-foreground" />
              Profile
            </button>
            <div className="border-t border-border" />
            <button
              onClick={() => { setOpen(false); navigate('/settings'); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-left"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              Settings
            </button>
            <div className="border-t border-border" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-destructive/10 text-destructive transition-colors text-left"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main layout (updated with draggable strip) ──────────────────────────
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [gateUser, setGateUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [isBlacklisted, setIsBlacklisted] = useState(false);

  const isTabRoute = TAB_PATHS.includes(location.pathname);
  const tabIndex = isTabRoute ? TAB_PATHS.indexOf(location.pathname) : 0;
  const [dragPercent, setDragPercent] = useState(0);
  const isDragging = dragPercent !== 0;
  const touchRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const stripRef = useRef(null);

  const mainRef = useRef(null);
  const accountTypeRef = useRef('driver');
  useEffect(() => { accountTypeRef.current = accountType; }, [accountType]);

  // ── Touch handlers ──────────────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    if (!isTabRoute) return;
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      active: true,
      axisLocked: false,
      horizontal: false,
    };
  }, [isTabRoute]);

  const onTouchMove = useCallback((e) => {
    const t = touchRef.current;
    if (!t.active) return;

    const dx = e.touches[0].clientX - t.startX;
    const dy = e.touches[0].clientY - t.startY;

    if (!t.axisLocked) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      t.axisLocked = true;
      t.horizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (!t.horizontal) return;
    e.preventDefault();

    let pct = (dx / window.innerWidth) * 100;
    if (pct > 0 && tabIndex === 0) pct *= 0.15;
    if (pct < 0 && tabIndex === TAB_PATHS.length - 1) pct *= 0.15;

    setDragPercent(pct);
  }, [tabIndex]);

  const onTouchEnd = useCallback(() => {
    const t = touchRef.current;
    t.active = false;
    if (!t.horizontal) return;

    if (dragPercent < -(THRESHOLD * 100) && tabIndex < TAB_PATHS.length - 1) {
      navigate(TAB_PATHS[tabIndex + 1]);
    } else if (dragPercent > (THRESHOLD * 100) && tabIndex > 0) {
      navigate(TAB_PATHS[tabIndex - 1]);
    }

    setDragPercent(0);
  }, [dragPercent, tabIndex, navigate]);

  useEffect(() => {
    setDragPercent(0);
  }, [location.pathname]);

  // ── Strip translation ───────────────────────────────────────────────────
  const N = TAB_PATHS.length;
  const baseX = -(tabIndex / N) * 100;
  const dragX = (dragPercent / 100) * (100 / N);
  const stripX = baseX + dragX;

  // ── Existing user loading & blacklist check ─────────────────────────────
  useEffect(() => {
    auth.me().then(async (user) => {
      setAccountType(user?.subscription_active ? (user?.subscription_plan || 'driver') : 'both');
      if (user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('blacklisted')
          .eq('id', user.id)
          .single();
        if (profile?.blacklisted) {
          try { await supabase.auth.signOut(); } catch { /* non-fatal */ }
          setIsBlacklisted(true);
          setUserLoading(false);
          return;
        }
      }
      setGateUser(user ?? null);
    }).catch(() => {}).finally(() => setUserLoading(false));
  }, []);

  // ── Biometric token refresh ─────────────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
          session?.refresh_token &&
          localStorage.getItem('scootlink_signin_method') === 'biometric') {
        fetch('/.netlify/functions/auth-set-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        }).catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Blacklisted screen ──────────────────────────────────────────────────
  if (isBlacklisted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-background to-red-50/30 flex items-center justify-center p-6">
        {/* … same as before … */}
      </div>
    );
  }

  return (
    <VerificationGate user={gateUser} userLoading={userLoading}>
      <div className="flex min-h-screen bg-background">
        <NavigationProgressBar pathname={location.pathname} />
        <Sidebar />

        <div className="relative flex-1 lg:ml-64 overflow-hidden flex flex-col h-screen">
          <MobileHeader />

          <div
            ref={stripRef}
            className="flex-1 min-h-0 overflow-hidden relative"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ touchAction: 'pan-y' }}
          >
            {isTabRoute ? (
              <div
                className="absolute inset-0 flex"
                style={{
                  width: `${N * 100}%`,
                  transform: `translateX(${stripX}%)`,
                  transition: isDragging ? 'none' : 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  willChange: 'transform',
                }}
              >
                {TABS.map(({ path, component: Page }, i) => {
                  const isVisible = Math.abs(i - tabIndex) <= 1;
                  return (
                    <div
                      key={path}
                      className="h-full overflow-y-auto pb-20 lg:pb-0"
                      style={{ width: `${100 / N}%`, flexShrink: 0 }}
                    >
                      {isVisible ? <Page /> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="scroll-container h-full overflow-y-auto pb-20 lg:pb-0">
                <Outlet />
              </div>
            )}
          </div>
        </div>

        <MobileNav />
      </div>
    </VerificationGate>
  );
}