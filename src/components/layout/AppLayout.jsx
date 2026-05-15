import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike, User, Settings, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase } from '@/api/supabaseData';

// Must match bottom nav order exactly: Home → Search → Track → Wallet → Messages
// Settings is in the header dropdown, not swipeable.
const TAB_ORDER = ['/', '/search-vehicles', '/tracking', '/wallet', '/messages'];

// ─── Navigation progress bar ──────────────────────────────────────────────────
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

// ─── Verification gate ────────────────────────────────────────────────────────
// Routes the user can always reach even before verification is complete.
const GATE_EXEMPT = ['/onboarding', '/subscription', '/settings', '/profile'];
const ADMIN_EMAILS = ['kanelothelejane@gmail.com'];

function VerificationGate({ user, userLoading, children }) {
  const location = useLocation();
  const navigate  = useNavigate();

  if (userLoading) return null; // wait — avoids flash of gate before user loads
  if (!user) return children;  // not logged in, router handles the auth redirect

  const isAdmin   = ADMIN_EMAILS.includes(user.email);
  const isExempt  = GATE_EXEMPT.some((p) => location.pathname.startsWith(p));
  if (isAdmin || isExempt) return children;

  // Step 1 — onboarding not started/completed → redirect immediately
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

  // Step 2 — onboarding done but admin hasn't verified yet → holding screen
  if (!user.verified) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2">Verification in progress</h2>
          <p className="text-muted-foreground text-sm max-w-xs">
            Your profile has been submitted and is being reviewed. You'll have full access as soon as it's approved — usually within 24 hours.
          </p>
        </div>
        <button
          className="px-6 py-3 rounded-xl border border-border text-sm font-medium hover:bg-accent transition-colors"
          onClick={() => navigate('/settings')}
        >
          View my profile
        </button>
      </div>
    );
  }

  return children;
}

// ─── Mobile header with profile dropdown ─────────────────────────────────────
function MobileHeader() {
  const navigate               = useNavigate();
  const [open, setOpen]        = useState(false);
  const dropdownRef            = useRef(null);

  // Close on outside click
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
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card z-30 shrink-0">
      {/* Logo */}
      <Link to="/" className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Bike className="w-4 h-4 text-white" />
        </div>
        <span className="text-base font-bold text-foreground">Skootlink</span>
      </Link>

      {/* Profile button + dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(v => !v)}
          className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${open ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
          aria-label="Account menu"
        >
          <User className="w-4 h-4" />
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

// ─── Main layout ──────────────────────────────────────────────────────────────
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [slideClass, setSlideClass] = useState('');
  const [gateUser, setGateUser]     = useState(null);
  const [userLoading, setUserLoading] = useState(true);

  const mainRef = useRef(null);
  const prevLocationRef = useRef(location.pathname);
  const accountTypeRef = useRef('driver');

  // Swipe tracking — only start/end positions, no live drag state
  const swipeRef = useRef({ x: 0, y: 0, active: false });

  useEffect(() => { accountTypeRef.current = accountType; }, [accountType]);

  useEffect(() => {
    const prevPath = prevLocationRef.current;
    const newPath = location.pathname;
    prevLocationRef.current = newPath;

    const normalize = (p) =>
      (p === '/find-drivers' || p === '/mysearch') ? '/search-vehicles' : p;

    const prevIndex = TAB_ORDER.indexOf(normalize(prevPath));
    const newIndex  = TAB_ORDER.indexOf(normalize(newPath));

    if (Math.abs(newIndex - prevIndex) >= 1 && prevIndex !== -1 && newIndex !== -1) {
      setSlideClass(newIndex > prevIndex ? 'slide-from-right' : 'slide-from-left');
      const t = setTimeout(() => setSlideClass(''), 350);
      return () => clearTimeout(t);
    } else {
      setSlideClass('');
    }
  }, [location.pathname]);

  useEffect(() => {
    auth.me().then(user => {
      // Unsubscribed users preview both owner + driver navigation
      setAccountType(user?.subscription_active ? (user?.subscription_plan || 'driver') : 'both');
      setGateUser(user ?? null);
    }).catch(() => {}).finally(() => setUserLoading(false));
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        session?.refresh_token &&
        localStorage.getItem('scootlink_signin_method') === 'biometric'
      ) {
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

  const getSearchPath = useCallback(() => {
    const type = accountTypeRef.current;
    if (type === 'owner') return '/find-drivers';
    if (type === 'both') return '/mysearch';
    return '/search-vehicles';
  }, []);

  const getCurrentTabIndex = useCallback((pathname) => {
    const path = pathname || location.pathname;
    if (path === '/search-vehicles' || path === '/find-drivers' || path === '/mysearch') return 1;
    return TAB_ORDER.indexOf(path);
  }, [location.pathname]);

  // ── Swipe detection ─────────────────────────────────────────────────────────
  //
  // No touchmove listener — adding a non-passive touchmove to window freezes
  // Android Chrome's scroll pipeline and makes the app appear unresponsive.
  //
  // Instead, we use touchend with { passive: false } so we can call
  // e.preventDefault() when a horizontal gesture is detected. Calling
  // preventDefault on touchend suppresses the synthetic click event that the
  // browser would otherwise fire — this is what was causing the Dashboard
  // bounce: the <Link to="/wallet"> wrapping WalletCard was receiving the
  // swipe gesture and navigating to /wallet before our threshold fired.
  //
  // touch-action: pan-y on the main element tells the browser "handle vertical
  // scrolling natively; horizontal touches go to JS". This prevents any native
  // rubber-band from horizontal movement on interactive child elements.
  useEffect(() => {
    const onTouchStart = (e) => {
      if (!mainRef.current?.contains(e.target)) return;
      swipeRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        active: true,
      };
    };

    const onTouchEnd = (e) => {
      const s = swipeRef.current;
      if (!s.active) return;
      s.active = false;

      const dx = e.changedTouches[0].clientX - s.x;
      const dy = e.changedTouches[0].clientY - s.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // Any meaningful horizontal movement (> 10 px, more horizontal than
      // vertical) → suppress the click so Links/buttons don't fire. This
      // prevents <Link to="/wallet"> from navigating on a swipe gesture.
      if (adx > 10 && adx > ady) {
        e.preventDefault();
      }

      // Navigate only on a clear long horizontal swipe (> 40 px and at least
      // twice as wide as it is tall so diagonal flicks don't trigger it).
      if (adx < 40 || adx < ady * 2) return;

      const currentIndex = getCurrentTabIndex();
      if (currentIndex === -1) return;

      if (dx < 0 && currentIndex < TAB_ORDER.length - 1) {
        const next = currentIndex === 0 ? getSearchPath() : TAB_ORDER[currentIndex + 1];
        navigate(next);
      } else if (dx > 0 && currentIndex > 0) {
        navigate(TAB_ORDER[currentIndex - 1]);
      }
    };

    const onTouchCancel = () => { swipeRef.current.active = false; };

    // touchstart: passive (we never call preventDefault here)
    // touchend:   non-passive so we can call preventDefault to suppress click
    // NO touchmove listener — intentionally omitted to preserve scroll performance
    window.addEventListener('touchstart',  onTouchStart,  { passive: true  });
    window.addEventListener('touchend',    onTouchEnd,    { passive: false });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true  });

    return () => {
      window.removeEventListener('touchstart',  onTouchStart);
      window.removeEventListener('touchend',    onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [getCurrentTabIndex, getSearchPath, navigate]);

  return (
    <VerificationGate user={gateUser} userLoading={userLoading}>
    <div className="flex min-h-screen bg-background">
      {/*
        1. transition: none !important  — kills the .main-content CSS rule
           that was animating the snap-back in earlier versions.
        2. touch-action: pan-y          — tells the browser "vertical scrolling
           only; horizontal belongs to JS." No native rubber-band on horizontal
           swipes anywhere in the main area, including inside Link/onClick children.
        3. overscroll-behavior-x: none  — belt-and-suspenders for horizontal
           overscroll on browsers that don't fully respect touch-action.
      */}
      <style>{`
        .main-content {
          transition: none !important;
          touch-action: pan-y;
          overscroll-behavior-x: none;
        }
        @keyframes slideFromRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0);    }
        }
        @keyframes slideFromLeft {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0);     }
        }
        .slide-from-right { animation: slideFromRight 0.3s ease-out forwards; }
        .slide-from-left  { animation: slideFromLeft  0.3s ease-out forwards; }
      `}</style>

      <NavigationProgressBar pathname={location.pathname} />
      <Sidebar />

      <div className="relative flex-1 lg:ml-64 overflow-hidden flex flex-col h-screen">
        {/* Header lives outside the animated element — never moves on swipe */}
        <MobileHeader />
        <main
          ref={mainRef}
          className={`flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0 main-content ${slideClass}`}
        >
          <Outlet />
        </main>
      </div>

      <MobileNav />
    </div>
    </VerificationGate>
  );
}
