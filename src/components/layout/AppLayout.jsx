import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike, User, Settings, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase, saveBiometricRefreshToken } from '@/api/supabaseData';
import LandingPage from '@/pages/LandingPage';
import { useNavigate as _useNavigate } from 'react-router-dom';

// ─── Page components for the five main tabs ────────────────────────────────
import HomePage from '@/pages/Dashboard';
import SearchPage from '@/pages/SearchPage';
import TrackingPage from '@/pages/Tracking';
import BriefcasePage from '@/pages/MyBriefcase';
import MessagesPage from '@/pages/Messages';

// ─── Search paths (dynamic based on account type) ───────────────────────────
const SEARCH_PATHS = ['/search-vehicles', '/find-drivers', '/mysearch'];
const CANONICAL_SEARCH_PATH = '/search-vehicles';
const CANONICAL_PATHS = ['/home', CANONICAL_SEARCH_PATH, '/tracking', '/briefcase', '/messages'];

const TABS = [
  { path: '/home',              component: HomePage,      icon: Bike, label: 'Home' },
  { path: CANONICAL_SEARCH_PATH, component: SearchPage,   icon: Bike, label: 'Search' },
  { path: '/tracking',         component: TrackingPage,   icon: Bike, label: 'Track' },
  { path: '/briefcase',        component: BriefcasePage,  icon: Bike, label: 'Briefcase' },
  { path: '/messages',         component: MessagesPage,   icon: Bike, label: 'Messages' },
];

const TAB_PATHS = TABS.reduce((acc, tab) => {
  if (tab.path === CANONICAL_SEARCH_PATH) {
    acc.push(...SEARCH_PATHS);
  } else {
    acc.push(tab.path);
  }
  return acc;
}, []);

const THRESHOLD = 0.3;

function getTabIndex(pathname) {
  if (SEARCH_PATHS.includes(pathname)) return 1;
  const idx = CANONICAL_PATHS.indexOf(pathname);
  return idx === -1 ? 0 : idx;
}

// ─── Navigation progress bar ──────────────────────────────────────────────
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

// ─── Verification gate ────────────────────────────────────────────────────
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

// ─── Shared biometric-aware logout ────────────────────────────────────────
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

// ─── Mobile header with profile dropdown ──────────────────────────────────
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
      <Link to="/home" className="flex items-center gap-2">
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

// ─── Main layout ──────────────────────────────────────────────────────────
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [gateUser, setGateUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [isBlacklisted, setIsBlacklisted] = useState(false);

  // ── Auth check (replaces old RootRoute in App.jsx) ─────────────────────
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser]       = useState(null);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const hasOAuthCode = params.has('code');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!hasOAuthCode) {
        setAuthLoading(false);
        setAuthUser(session?.user ?? null);
      }
    });

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthLoading(false);
      setAuthUser(session?.user ?? null);
    });

    return () => authSub?.unsubscribe();
  }, []);

  // ── Strip swipe state ──────────────────────────────────────────────────
  const isTabRoute = TAB_PATHS.includes(location.pathname);
  const tabIndex = isTabRoute ? getTabIndex(location.pathname) : 0;
  const [dragPercent, setDragPercent] = useState(0);
  const isDragging = dragPercent !== 0;
  const touchRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const stripRef = useRef(null);

  const mainRef = useRef(null);
  const accountTypeRef = useRef('driver');
  useEffect(() => { accountTypeRef.current = accountType; }, [accountType]);

  // ── Touch handlers ─────────────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    if (e.target.closest('[data-no-swipe]')) return;
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
    if (pct < 0 && tabIndex === CANONICAL_PATHS.length - 1) pct *= 0.15;

    setDragPercent(pct);
  }, [tabIndex]);

  const onTouchEnd = useCallback(() => {
    const t = touchRef.current;
    t.active = false;
    if (!t.horizontal) return;

    if (dragPercent < -(THRESHOLD * 100) && tabIndex < CANONICAL_PATHS.length - 1) {
      navigate(CANONICAL_PATHS[tabIndex + 1]);
    } else if (dragPercent > (THRESHOLD * 100) && tabIndex > 0) {
      navigate(CANONICAL_PATHS[tabIndex - 1]);
    }

    setDragPercent(0);
  }, [dragPercent, tabIndex, navigate]);

  useEffect(() => {
    setDragPercent(0);
  }, [location.pathname]);

  // ── Strip translation ──────────────────────────────────────────────────
  const N = CANONICAL_PATHS.length;
  const baseX = -(tabIndex / N) * 100;
  const dragX = (dragPercent / 100) * (100 / N);
  const stripX = baseX + dragX;

  // ── Existing user loading & blacklist check ────────────────────────────
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

  // ── Biometric token refresh ────────────────────────────────────────────
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

  // ── Auth gate: show spinner then landing page if not logged in ─────────
  if (authLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!authUser) {
    // Not logged in — send to /auth. The landing page lives at / independently.
    window.location.replace('/auth');
    return null;
  }

  // ── Blacklisted screen ─────────────────────────────────────────────────
  if (isBlacklisted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-background to-red-50/30 flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-red-700">Account Suspended</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your Skootlink account has been suspended and you cannot access the platform at this time.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              If you believe this is a mistake, please contact our support team and we will review your account.
            </p>
          </div>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Any remaining funds in your Skootlink wallet will be returned to you.
              Email <span className="font-semibold text-foreground">help@skootlink.co.za</span> from
              your registered email address to request a withdrawal of your balance.
            </p>
            <a
              href="mailto:help@skootlink.co.za"
              className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              Contact Support — help@skootlink.co.za
            </a>
            <p className="text-xs text-muted-foreground">
              Wallet withdrawal requests are processed within 5–7 business days.
            </p>
          </div>
        </div>
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
                      style={{ width: `${100 / N}%`, flexShrink: 0, minHeight: '100vh' }}
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