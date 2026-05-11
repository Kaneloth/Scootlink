import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth } from '@/api/supabaseData';

// Import all main tab components (these will be rendered inside the swipe container)
import Dashboard from '@/pages/Dashboard';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';
import SearchPage from '@/pages/SearchPage';
import Tracking from '@/pages/Tracking';
import Wallet from '@/pages/Wallet';
import Settings from '@/pages/Settings';
import Messages from '@/pages/Messages';

// All paths that are considered "main tabs" (bottom navigation + search variants)
const MAIN_TAB_PATHS = [
  '/',
  '/search-vehicles',
  '/find-drivers',
  '/mysearch',
  '/messages',
  '/tracking',
  '/wallet',
  '/settings',
];

// Helper: return the correct search component and path based on user's plan
function getSearchComponent(plan) {
  if (plan === 'owner') return <FindDrivers />;
  if (plan === 'both') return <SearchPage />;
  return <SearchVehicles />;
}

function getSearchPath(plan) {
  if (plan === 'owner') return '/find-drivers';
  if (plan === 'both') return '/mysearch';
  return '/search-vehicles';
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [activeTab, setActiveTab] = useState(0);
  const swipeRef = useRef(null);
  const scrollToTabRef = useRef(null); // will hold a stable reference

  // Fetch user's plan
  useEffect(() => {
    auth.me().then(user => setAccountType(user?.subscription_plan || 'driver')).catch(() => {});
  }, []);

  // Determine if we are currently on a main tab page
  const isMainTab = MAIN_TAB_PATHS.includes(location.pathname);

  // Build the tab components list (order matters for swiping)
  const tabs = [
    { component: <Dashboard />, path: '/' },
    { component: getSearchComponent(accountType), path: getSearchPath(accountType) },
    { component: <Messages />, path: '/messages' },
    { component: <Tracking />, path: '/tracking' },
    { component: <Wallet />, path: '/wallet' },
    { component: <Settings />, path: '/settings' },
  ];

  // Map paths to indices for highlighting the bottom nav
  const pathToIndex = {
    '/': 0,
    '/search-vehicles': 1, '/find-drivers': 1, '/mysearch': 1,
    '/messages': 2,
    '/tracking': 3,
    '/wallet': 4,
    '/settings': 5,
  };

  // Sync active tab from URL when on a main tab
  useEffect(() => {
    if (isMainTab) {
      setActiveTab(pathToIndex[location.pathname] ?? 0);
    }
  }, [location.pathname, isMainTab]);

  // Scroll to a specific tab (used by MobileNav)
  const scrollToTab = (index) => {
    if (swipeRef.current) {
      const containerWidth = swipeRef.current.offsetWidth;
      swipeRef.current.scrollTo({
        left: index * containerWidth,
        behavior: 'smooth',
      });
    }
  };

  // Keep scrollToTab reference stable
  useEffect(() => {
    scrollToTabRef.current = scrollToTab;
  }, [scrollToTab]);

  // Listen for scroll events to update active tab (so bottom nav highlights correctly)
  const handleScroll = () => {
    if (!swipeRef.current) return;
    const containerWidth = swipeRef.current.offsetWidth;
    const scrollLeft = swipeRef.current.scrollLeft;
    const newIndex = Math.round(scrollLeft / containerWidth);
    setActiveTab(newIndex);
  };

  useEffect(() => {
    const cont = swipeRef.current;
    if (cont && isMainTab) {
      cont.addEventListener('scroll', handleScroll, { passive: true });
    }
    return () => {
      if (cont) cont.removeEventListener('scroll', handleScroll);
    };
  }, [isMainTab]);

  // When swipe scroll finishes, update the route (so Desktop & URL reflect current tab)
  const handleSwipeEnd = () => {
    if (!swipeRef.current) return;
    const containerWidth = swipeRef.current.offsetWidth;
    const scrollLeft = swipeRef.current.scrollLeft;
    const snapIndex = Math.round(scrollLeft / containerWidth);
    const targetPath = tabs[snapIndex]?.path;
    if (targetPath && location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 lg:ml-64 h-screen overflow-hidden relative">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center px-4 py-3 border-b border-border bg-card sticky top-0 z-30">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Bike className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold text-foreground">Scootlink</span>
          </Link>
        </div>

        {/* Desktop: normal router output */}
        <div className="hidden lg:block h-full overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </div>

        {/* Mobile: swipeable tabs for main pages, otherwise Outlet */}
        <div className="lg:hidden h-[calc(100vh-120px)]">
          {isMainTab ? (
            <div
              ref={swipeRef}
              className="swipe-container flex overflow-x-auto overflow-y-hidden h-full"
              onTouchEnd={handleSwipeEnd}
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {tabs.map((tab, idx) => (
                <div key={tab.path} className="swipe-page h-full overflow-y-auto pb-20">
                  {tab.component}
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full overflow-y-auto pb-20">
              <Outlet />
            </div>
          )}
        </div>

        {/* Bottom navigation – always visible */}
        <MobileNav activeTab={activeTab} onScrollToTab={(index) => scrollToTabRef.current?.(index)} />
      </div>
    </div>
  );
}
