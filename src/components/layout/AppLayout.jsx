import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Bike } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth } from '@/api/supabaseData';   // to get user's plan for dynamic Search path

// Static tab keys (order matters)
const TAB_KEYS = ['home', 'search', 'messages', 'track', 'wallet', 'settings'];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const mainRef = useRef(null);

  // Fetch user's plan so we know the correct Search path
  useEffect(() => {
    auth.me().then(user => {
      setAccountType(user?.subscription_plan || 'driver');
    }).catch(() => {});
  }, []);

  // Map tab keys to actual paths, respecting the user's plan for Search
  const getTabPath = useCallback((key) => {
    switch (key) {
      case 'home': return '/';
      case 'search':
        if (accountType === 'owner') return '/find-drivers';
        if (accountType === 'both') return '/mysearch';
        return '/search-vehicles';               // driver
      case 'messages': return '/messages';
      case 'track': return '/tracking';
      case 'wallet': return '/wallet';
      case 'settings': return '/settings';
      default: return '/';
    }
  }, [accountType]);

  // Get the current tab key based on the current path
  const getCurrentTabKey = useCallback(() => {
    const path = location.pathname;
    for (const key of TAB_KEYS) {
      if (path === getTabPath(key)) return key;
    }
    return null; // not a tab page (e.g., add-vehicle, profile, etc.)
  }, [location.pathname, getTabPath]);

  // Swipe handlers
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
      const currentKey = getCurrentTabKey();
      if (!currentKey) return; // not on a tab page – ignore swipe

      const currentIndex = TAB_KEYS.indexOf(currentKey);
      if (dx < 0 && currentIndex < TAB_KEYS.length - 1) {
        // Swipe left → next tab
        navigate(getTabPath(TAB_KEYS[currentIndex + 1]));
      } else if (dx > 0 && currentIndex > 0) {
        // Swipe right → previous tab
        navigate(getTabPath(TAB_KEYS[currentIndex - 1]));
      }
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main
        ref={mainRef}
        className="flex-1 lg:ml-64 h-screen overflow-y-auto pb-20 lg:pb-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile top bar with logo – unchanged */}
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
