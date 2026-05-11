import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth } from '@/api/supabaseData';

const TAB_ORDER = ['/', '/search-vehicles', '/messages', '/tracking', '/wallet', '/settings'];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const mainRef = useRef(null);
  const dragState = useRef({ startX: 0, startY: 0, isDragging: false, offsetX: 0 });
  const rafRef = useRef(null);
  const prevPathRef = useRef(location.pathname);
  const [slideClass, setSlideClass] = useState('');

  // Slide animation on route change
  useEffect(() => {
    const prev = prevPathRef.current;
    const next = location.pathname;
    prevPathRef.current = next;

    const prevIdx = TAB_ORDER.indexOf(prev);
    const nextIdx = TAB_ORDER.indexOf(next);

    if (Math.abs(nextIdx - prevIdx) === 1) {
      setSlideClass(nextIdx > prevIdx ? 'slide-from-right' : 'slide-from-left');
      const t = setTimeout(() => setSlideClass(''), 350);
      return () => clearTimeout(t);
    } else {
      setSlideClass('');
    }
  }, [location.pathname]);

  useEffect(() => {
    auth.me().then(u => setAccountType(u?.subscription_plan || 'driver')).catch(() => {});
  }, []);

  const getCurrentTabIndex = useCallback(() => {
    const path = location.pathname;
    if (['/search-vehicles', '/find-drivers', '/mysearch'].includes(path)) return 1;
    return TAB_ORDER.indexOf(path);
  }, [location.pathname]);

  // ---------- Smooth direct‑DOM drag ----------
  const handleTouchStart = (e) => {
    dragState.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      isDragging: false,
      offsetX: 0,
    };
    // Remove any transition while dragging
    mainRef.current.style.transition = 'none';
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const handleTouchMove = (e) => {
    const { startX, startY, isDragging } = dragState.current;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!isDragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 2) {
      dragState.current.isDragging = true;
    }

    if (dragState.current.isDragging) {
      e.preventDefault();
      dragState.current.offsetX = dx;
      // Direct DOM update – no React state, so instant and smooth
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        mainRef.current.style.transform = `translateX(${dx}px)`;
      });
    }
  };

  const handleTouchEnd = () => {
    const { isDragging, offsetX } = dragState.current;
    if (!isDragging) {
      mainRef.current.style.transition = 'transform 0.3s ease-out';
      mainRef.current.style.transform = 'translateX(0)';
      return;
    }

    const containerWidth = mainRef.current?.offsetWidth || window.innerWidth;
    const threshold = containerWidth * 0.25;
    const currentIndex = getCurrentTabIndex();

    if (currentIndex !== -1) {
      if (offsetX < -threshold && currentIndex < TAB_ORDER.length - 1) {
        // Snap left → next tab
        mainRef.current.style.transition = 'transform 0.25s ease-out';
        mainRef.current.style.transform = `translateX(-${containerWidth}px)`;
        setTimeout(() => {
          navigate(TAB_ORDER[currentIndex + 1]);
          mainRef.current.style.transition = 'none';
          mainRef.current.style.transform = 'translateX(0)';
        }, 200);
        return;
      } else if (offsetX > threshold && currentIndex > 0) {
        // Snap right → previous tab
        mainRef.current.style.transition = 'transform 0.25s ease-out';
        mainRef.current.style.transform = `translateX(${containerWidth}px)`;
        setTimeout(() => {
          navigate(TAB_ORDER[currentIndex - 1]);
          mainRef.current.style.transition = 'none';
          mainRef.current.style.transform = 'translateX(0)';
        }, 200);
        return;
      }
    }

    // Not enough drag – bounce back
    mainRef.current.style.transition = 'transform 0.3s ease-out';
    mainRef.current.style.transform = 'translateX(0)';
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main
        ref={mainRef}
        className={`flex-1 lg:ml-64 h-screen overflow-y-auto pb-20 lg:pb-0 ${slideClass}`}
        style={{ willChange: 'transform' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
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
      <MobileNav />
    </div>
  );
}
