import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth } from '@/api/supabaseData';

// Tab order for swipe navigation (matches bottom nav)
const TAB_ORDER = ['/', '/search-vehicles', '/messages', '/tracking', '/wallet', '/settings'];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');

  // Swipe gesture state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const mainRef = useRef(null);
  const prevLocationRef = useRef(location.pathname);
  const [slideClass, setSlideClass] = useState('');

  // Determine direction of navigation for slide animation
  useEffect(() => {
    const prevPath = prevLocationRef.current;
    const newPath = location.pathname;
    prevLocationRef.current = newPath;

    const prevIndex = TAB_ORDER.indexOf(prevPath);
    const newIndex = TAB_ORDER.indexOf(newPath);

    // Only animate if we're moving between adjacent tabs (index difference of 1)
    if (Math.abs(newIndex - prevIndex) === 1) {
      setSlideClass(newIndex > prevIndex ? 'slide-from-right' : 'slide-from-left');
      const timer = setTimeout(() => setSlideClass(''), 300); // remove after animation
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

  // Helpers
  const getCurrentTabIndex = useCallback(() => {
    const path = location.pathname;
    // Map dynamic search paths to index 1
    if (path === '/search-vehicles' || path === '/find-drivers' || path === '/mysearch') return 1;
    return TAB_ORDER.indexOf(path);
  }, [location.pathname]);

  // Touch handlers
  const handleTouchStart = (e) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    setIsDragging(false);
    setDragOffset(0);
  };

  const handleTouchMove = (e) => {
    const { x: startX, y: startY } = touchStartRef.current;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    // Only start horizontal drag if horizontal movement is dominant (> 10px and ratio > 2)
    if (!isDragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 2) {
      setIsDragging(true);
    }

    if (isDragging) {
      e.preventDefault(); // prevent vertical scrolling while dragging horizontally
      setDragOffset(dx);
    }
  };

  const handleTouchEnd = (e) => {
    if (!isDragging) return;

    const containerWidth = mainRef.current?.offsetWidth || window.innerWidth;
    const threshold = containerWidth * 0.25; // 25% of screen width
    const dx = dragOffset;

    const currentIndex = getCurrentTabIndex();
    if (currentIndex === -1) {
      // Not a tab page – reset
      setDragOffset(0);
      setIsDragging(false);
      return;
    }

    if (dx < -threshold && currentIndex < TAB_ORDER.length - 1) {
      // Swipe left → next tab
      navigate(TAB_ORDER[currentIndex + 1]);
    } else if (dx > threshold && currentIndex > 0) {
      // Swipe right → previous tab
      navigate(TAB_ORDER[currentIndex - 1]);
    }

    // Reset drag
    setDragOffset(0);
    setIsDragging(false);
  };

  // Compute inline transform for the drag effect
  const transformStyle = isDragging ? `translateX(${dragOffset}px)` : 'translateX(0)';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main
        ref={mainRef}
        className={`flex-1 lg:ml-64 h-screen overflow-y-auto pb-20 lg:pb-0 main-content ${slideClass}`}
        style={{ transform: transformStyle, transition: isDragging ? 'none' : 'transform 0.3s ease-out' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
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
      <MobileNav />
    </div>
  );
}
