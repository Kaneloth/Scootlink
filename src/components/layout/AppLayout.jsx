import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike, LayoutDashboard, Search, MessageCircle, MapPin, Wallet, Settings, ChevronRight, ChevronLeft } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase } from '@/api/supabaseData';

const TAB_ORDER = ['/', '/search-vehicles', '/messages', '/tracking', '/wallet', '/settings'];

const TAB_META = {
  '/':                { label: 'Home',     icon: LayoutDashboard },
  '/search-vehicles': { label: 'Search',   icon: Search          },
  '/find-drivers':    { label: 'Search',   icon: Search          },
  '/mysearch':        { label: 'Search',   icon: Search          },
  '/messages':        { label: 'Messages', icon: MessageCircle   },
  '/tracking':        { label: 'Track',    icon: MapPin          },
  '/wallet':          { label: 'Wallet',   icon: Wallet          },
  '/settings':        { label: 'Settings', icon: Settings        },
};

function useNavigationProgress(pathname) {
  const [barState, setBarState] = useState({ width: 0, visible: false, done: false });
  const prevPathRef = useRef(pathname);
  const timersRef = useRef([]);

  const clear = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

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
      <div
        style={{
          height: '100%',
          width: `${width}%`,
          transition: width === 0 ? 'none' : done ? 'width 0.2s ease-in, opacity 0.3s ease-out 0.05s' : 'width 0.4s ease-out',
          opacity: done ? 0 : 1,
          background: 'hsl(var(--primary))',
          boxShadow: '0 0 8px hsl(var(--primary) / 0.6)',
          borderRadius: '0 2px 2px 0',
        }}
      />
    </div>
  );
}

function PeekStrip({ direction, tab, progress }) {
  if (!tab) return null;
  const Icon = tab.icon;
  const opacity = Math.min(progress * 2.5, 1);
  const isRight = direction === 'right';
  return (
    <div
      className={`absolute inset-y-0 ${isRight ? 'right-0' : 'left-0'} w-20 flex flex-col items-center justify-center gap-1.5 pointer-events-none z-20`}
      style={{
        opacity,
        background: isRight
          ? 'linear-gradient(to left, hsl(var(--card)) 30%, transparent)'
          : 'linear-gradient(to right, hsl(var(--card)) 30%, transparent)',
      }}
    >
      {isRight ? (
        <ChevronRight className="w-4 h-4 text-primary/60" />
      ) : (
        <ChevronLeft className="w-4 h-4 text-primary/60" />
      )}
      <Icon className="w-5 h-5 text-primary" />
      <span className="text-[10px] font-semibold text-primary">{tab.label}</span>
    </div>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');

  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const mainRef = useRef(null);
  const prevLocationRef = useRef(location.pathname);
  const [slideClass, setSlideClass] = useState('');
  const accountTypeRef = useRef('driver');

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
      const timer = setTimeout(() => setSlideClass(''), 320);
      return () => clearTimeout(timer);
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

  const peekInfo = useMemo(() => {
    if (!isDragging) return null;
    const containerWidth = mainRef.current?.offsetWidth || window.innerWidth;
    const threshold = containerWidth * 0.25;
    const currentIndex = getCurrentTabIndex();
    if (currentIndex === -1) return null;
    const progress = Math.abs(dragOffset) / threshold;
    if (dragOffset < -10 && currentIndex < TAB_ORDER.length - 1) {
      const nextPath = currentIndex === 0 ? getSearchPath() : TAB_ORDER[currentIndex + 1];
      return { direction: 'right', tab: TAB_META[nextPath] || TAB_META[TAB_ORDER[currentIndex + 1]], progress };
    }
    if (dragOffset > 10 && currentIndex > 0) {
      return { direction: 'left', tab: TAB_META[TAB_ORDER[currentIndex - 1]], progress };
    }
    return null;
  }, [isDragging, dragOffset, getCurrentTabIndex, getSearchPath]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    // Register touchstart as non-passive so the browser knows we may call
    // preventDefault — this lets us "win" against scrollable children
    // (messages list, search results) on iOS and Android.
    const handleTouchStartNative = (e) => {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      isDraggingRef.current = false;
      dragOffsetRef.current = 0;
    };

    const handleTouchMove = (e) => {
      const { x: startX, y: startY } = touchStartRef.current;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // 1.2× ratio catches horizontal swipes early, before the browser
      // can assign the touch to a scrollable child for vertical scrolling.
      if (!isDraggingRef.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        isDraggingRef.current = true;
        setIsDragging(true);
      }

      if (isDraggingRef.current) {
        e.preventDefault();
        dragOffsetRef.current = dx;
        setDragOffset(dx);
      }
    };

    el.addEventListener('touchstart', handleTouchStartNative, { passive: false });
    el.addEventListener('touchmove',  handleTouchMove,        { passive: false });
    return () => {
      el.removeEventListener('touchstart', handleTouchStartNative);
      el.removeEventListener('touchmove',  handleTouchMove);
    };
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;

    const containerWidth = mainRef.current?.offsetWidth || window.innerWidth;
    const threshold = containerWidth * 0.25;
    const dx = dragOffsetRef.current;
    const currentIndex = getCurrentTabIndex();

    if (currentIndex !== -1) {
      if (dx < -threshold && currentIndex < TAB_ORDER.length - 1) {
        const nextPath = currentIndex === 0 ? getSearchPath() : TAB_ORDER[currentIndex + 1];
        navigate(nextPath);
      } else if (dx > threshold && currentIndex > 0) {
        navigate(TAB_ORDER[currentIndex - 1]);
      }
    }

    isDraggingRef.current = false;
    dragOffsetRef.current = 0;
    setIsDragging(false);
    setDragOffset(0);
  }, [getCurrentTabIndex, getSearchPath, navigate]);

  const inlineStyle = {
    // pan-y = browser handles vertical scroll natively, JS handles horizontal.
    // Fixes the "bounce and snap back" on pages with scrollable content.
    touchAction: isDragging ? 'none' : 'pan-y',
    ...(isDragging
      ? { transform: `translateX(${dragOffset}px)`, transition: 'none' }
      : slideClass
        ? {}
        : { transform: 'translateX(0)', transition: 'none' }),
  };

  return (
    <div className="flex min-h-screen bg-background">
      <NavigationProgressBar pathname={location.pathname} />

      <Sidebar />

      <div className="relative flex-1 lg:ml-64 overflow-hidden">
        {peekInfo && (
          <PeekStrip
            direction={peekInfo.direction}
            tab={peekInfo.tab}
            progress={peekInfo.progress}
          />
        )}

        <main
          ref={mainRef}
          className={`h-screen overflow-y-auto pb-20 lg:pb-0 main-content ${slideClass}`}
          style={inlineStyle}
          onTouchEnd={handleTouchEnd}
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