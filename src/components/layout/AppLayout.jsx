import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase } from '@/api/supabaseData';

const TAB_ORDER = ['/', '/search-vehicles', '/messages', '/tracking', '/wallet', '/settings'];

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

// ─── Main layout ──────────────────────────────────────────────────────────────
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [slideClass, setSlideClass] = useState('');

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
      setAccountType(user?.subscription_plan || 'driver');
    }).catch(() => {});
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

      <div className="relative flex-1 lg:ml-64 overflow-hidden">
        <main
          ref={mainRef}
          className={`h-screen overflow-y-auto pb-20 lg:pb-0 main-content ${slideClass}`}
        >
          <div className="lg:hidden flex items-center px-4 py-3 border-b border-border bg-card sticky top-0 z-30">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Bike className="w-4 h-4 text-white" />
              </div>
              <span className="text-base font-bold text-foreground">Scootlink</span>
            </Link>
          </div>
          <Outlet />
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
