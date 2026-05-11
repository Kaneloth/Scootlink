import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike, LayoutDashboard, Search, MessageCircle, MapPin, Wallet, Settings, ChevronRight, ChevronLeft } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth } from '@/api/supabaseData';

// Tab order for swipe navigation (matches bottom nav order)
const TAB_ORDER = ['/', '/search-vehicles', '/messages', '/tracking', '/wallet', '/settings'];

// Metadata for each tab — used by the peek indicator
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

// Peek strip that appears on the edge being swiped toward
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

  // Use refs for drag state inside event listeners to avoid stale closures
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const mainRef = useRef(null);
  const prevLocationRef = useRef(location.pathname);
  const [slideClass, setSlideClass] = useState('');
  const accountTypeRef = useRef('driver');

  // Keep accountTypeRef in sync so touchEnd handler can read it without stale closure
  useEffect(() => {
    accountTypeRef.current = accountType;
  }, [accountType]);

  // Determine slide direction when route changes
  useEffect(() => {
    const prevPath = prevLocationRef.current;
    const newPath = location.pathname;
    prevLocationRef.current = newPath;

    const prevIndex = TAB_ORDER.indexOf(prevPath);
    const newIndex = TAB_ORDER.indexOf(newPath);

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

  // Get the correct search path based on account type
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

  // Peek strip: which adjacent tab to show and on which side
  const peekInfo = useMemo(() => {
    if (!isDragging) return null;
    const containerWidth = mainRef.current?.offsetWidth || window.innerWidth;
    const threshold = containerWidth * 0.25;
    const currentIndex = getCurrentTabIndex();
    if (currentIndex === -1) return null;

    const progress = Math.abs(dragOffset) / threshold; // 0 → 1 at threshold

    if (dragOffset < -10 && currentIndex < TAB_ORDER.length - 1) {
      // Swiping left — next tab peeks from the right edge
      const nextPath = currentIndex === 0 ? getSearchPath() : TAB_ORDER[currentIndex + 1];
      return { direction: 'right', tab: TAB_META[nextPath] || TAB_META[TAB_ORDER[currentIndex + 1]], progress };
    }
    if (dragOffset > 10 && currentIndex > 0) {
      // Swiping right — previous tab peeks from the left edge
      return { direction: 'left', tab: TAB_META[TAB_ORDER[currentIndex - 1]], progress };
    }
    return null;
  }, [isDragging, dragOffset, getCurrentTabIndex, getSearchPath]);

  // Register a NON-PASSIVE touchmove listener directly on the DOM element.
  // React's synthetic onTouchMove is passive by default in modern browsers,
  // which means e.preventDefault() is silently ignored and the page scrolls
  // instead of swiping. This is the fix for that.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const handleTouchMove = (e) => {
      const { x: startX, y: startY } = touchStartRef.current;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const dx = currentX - startX;
      const dy = currentY - startY;

      // Start drag only when horizontal movement is clearly dominant
      if (!isDraggingRef.current && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 2) {
        isDraggingRef.current = true;
        setIsDragging(true);
      }

      if (isDraggingRef.current) {
        e.preventDefault(); // works because listener is non-passive
        dragOffsetRef.current = dx;
        setDragOffset(dx);
      }
    };

    // { passive: false } is required to allow e.preventDefault()
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleTouchMove);
  }, []);

  const handleTouchStart = (e) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    isDraggingRef.current = false;
    dragOffsetRef.current = 0;
    setIsDragging(false);
    setDragOffset(0);
  };

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;

    const containerWidth = mainRef.current?.offsetWidth || window.innerWidth;
    const threshold = containerWidth * 0.25; // 25% of screen width
    const dx = dragOffsetRef.current;
    const currentIndex = getCurrentTabIndex();

    if (currentIndex !== -1) {
      if (dx < -threshold && currentIndex < TAB_ORDER.length - 1) {
        // Swipe left → next tab (use dynamic search path from index 0)
        const nextPath = currentIndex === 0 ? getSearchPath() : TAB_ORDER[currentIndex + 1];
        navigate(nextPath);
      } else if (dx > threshold && currentIndex > 0) {
        // Swipe right → previous tab
        navigate(TAB_ORDER[currentIndex - 1]);
      }
    }

    isDraggingRef.current = false;
    dragOffsetRef.current = 0;
    setIsDragging(false);
    setDragOffset(0);
  }, [getCurrentTabIndex, getSearchPath, navigate]);

  // Inline style logic:
  // - While dragging: apply live transform, no transition (instant feedback)
  // - After drag ends, no navigation: snap back with a short transition
  // - After navigation: clear inline styles so CSS animation (slideClass) runs unobstructed
  const inlineStyle = isDragging
    ? { transform: `translateX(${dragOffset}px)`, transition: 'none' }
    : slideClass
      ? {}
      : { transform: 'translateX(0)', transition: 'transform 0.25s ease-out' };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      {/* Outer wrapper clips the dragging content and hosts the peek strips */}
      <div className="relative flex-1 lg:ml-64 overflow-hidden">
        {/* Peek strip — visible only while dragging */}
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
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Mobile top bar */}
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
