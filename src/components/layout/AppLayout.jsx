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
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  // Fetch user's plan so the Search path can be corrected if needed (for the Desktop sidebar/links)
  useEffect(() => {
    auth.me().then(user => {
      setAccountType(user?.subscription_plan || 'driver');
    }).catch(() => {});
  }, []);

  // Helper to get the correct Search path for swipe (but swipe always uses default search path,
  // the dynamic Search path for bottom nav is handled inside MobileNav)
  const getTabPaths = useCallback(() => {
    return TAB_ORDER; // swiping will always cycle through the base tabs
  }, []);

  // Get current tab index based on URL
  const getCurrentTabIndex = useCallback(() => {
    const path = location.pathname;
    // For the dynamic search path, map it to index 1 if it's any of the search variants
    if (path === '/search-vehicles' || path === '/find-drivers' || path === '/mysearch') return 1;
    return TAB_ORDER.indexOf(path);
  }, [location.pathname]);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const dx = touchEndX - touchStartX.current;
    const dy = touchEndY - touchStartY.current;

    // Only react if horizontal swipe is dominant (> 50px and more horizontal than vertical)
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const currentIndex = getCurrentTabIndex();
      if (currentIndex === -1) return; // not a tab page – ignore

      if (dx < 0 && currentIndex < TAB_ORDER.length - 1) {
        // Swipe left → next tab
        navigate(TAB_ORDER[currentIndex + 1]);
      } else if (dx > 0 && currentIndex > 0) {
        // Swipe right → previous tab
        navigate(TAB_ORDER[currentIndex - 1]);
      }
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main
        className="flex-1 lg:ml-64 h-screen overflow-y-auto pb-20 lg:pb-0"
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
      <MobileNav />
    </div>
  );
}
