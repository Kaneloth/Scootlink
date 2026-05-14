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

  // Swipe state: tracks one touch gesture from start to end
  const swipeRef = useRef({ x: 0, y: 0, active: false, isHorizontal: null });

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

  // ── Touch / swipe handling ──────────────────────────────────────────────────
  //
  // Strategy: determine swipe direction on the first few pixels of touchmove
  // and immediately call e.preventDefault() if it's horizontal. This kills
  // the iOS rubber-band bounce that fires on interactive elements (Links,
  // onClick divs) BEFORE our threshold distance is reached. The bounce the
  // user was seeing on the Dashboard was 100% iOS rubber-banding triggered by
  // WalletCard (inside a <Link>) and the stat card onClick divs.
  //
  // Listeners are on `window` so scrollable-child elements (messages list,
  // search results) cannot silently consume the touch before we see it.
  useEffect(() => {
    const onTouchStart = (e) => {
      if (!mainRef.current?.contains(e.target)) return;
      swipeRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        active: true,
        isHorizontal: null, // null = not yet determined
      };
    };

    const onTouchMove = (e) => {
      const s = swipeRef.current;
      if (!s.active) return;

      // Wait until we have enough movement to determine direction
      if (s.isHorizontal !== null) {
        // Direction already locked — if horizontal, keep blocking default
        if (s.isHorizontal) e.preventDefault();
        return;
      }

      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      if (adx < 6 && ady < 6) return; // not enough movement yet

      if (adx > ady * 1.2) {
        // Clearly horizontal — lock and prevent default immediately.
        // This is the key: calling preventDefault here stops iOS from
        // rubber-banding the page, which was the "bounce" on Dashboard.
        s.isHorizontal = true;
        e.preventDefault();
      } else {
        // Clearly vertical — let the browser handle the scroll naturally
        s.isHorizontal = false;
        s.active = false; // stop tracking this gesture
      }
    };

    const onTouchEnd = (e) => {
      const s = swipeRef.current;
      if (!s.active || !s.isHorizontal) {
        swipeRef.current.active = false;
        return;
      }
      swipeRef.current.active = false;

      const dx = e.changedTouches[0].clientX - s.x;
      const dy = e.changedTouches[0].clientY - s.y;

      // Navigate if the horizontal distance clears 40 px and is more
      // horizontal than vertical (guards against diagonal flicks).
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

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

    // touchstart can be passive (we never preventDefault here)
    // touchmove must be non-passive so we can call preventDefault
    window.addEventListener('touchstart',  onTouchStart,  { passive: true  });
    window.addEventListener('touchmove',   onTouchMove,   { passive: false });
    window.addEventListener('touchend',    onTouchEnd,    { passive: true  });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true  });

    return () => {
      window.removeEventListener('touchstart',  onTouchStart);
      window.removeEventListener('touchmove',   onTouchMove);
      window.removeEventListener('touchend',    onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [getCurrentTabIndex, getSearchPath, navigate]);

  return (
    <div className="flex min-h-screen bg-background">
      {/*
        1. `.main-content { transition: none !important }` — kills the global
           CSS rule that was animating the snap-back and causing the bounce in
           earlier versions.
        2. Slide keyframes redefined here so they are guaranteed to exist
           even if the external CSS file fails to load or is overridden.
        3. `overscroll-behavior-x: none` on main — secondary guard against
           horizontal rubber-banding that the touchmove preventDefault misses.
      */}
      <style>{`
        .main-content {
          transition: none !important;
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
