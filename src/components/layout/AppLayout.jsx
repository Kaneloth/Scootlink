import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth } from '@/api/supabaseData';

// Import all main tab pages (these will be rendered inside the swipe container)
import Dashboard from '@/pages/Dashboard';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';
import SearchPage from '@/pages/SearchPage';
import Trackings from '@/pages/Tracking';
import Wallet from '@/pages/Wallet';
import Settings from '@/pages/Settings';
import Messages from '@/pages/Messages';

export default function AppLayout() {
  const [accountType, setAccountType] = useState('driver');
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    auth.me().then(user => {
      setAccountType(user?.subscription_plan || 'driver');
    }).catch(() => {});
  }, []);

  // Tabs in order – each has a key, component, and path (used later)
  const tabs = [
    { key: 'home', component: <Dashboard />, path: '/' },
    { key: 'search', component: getSearchComponent(accountType), path: getSearchPath(accountType) },
    { key: 'messages', component: <Messages />, path: '/messages' },
    { key: 'track', component: <Trackings />, path: '/tracking' },
    { key: 'wallet', component: <Wallet />, path: '/wallet' },
    { key: 'settings', component: <Settings />, path: '/settings' },
  ];

  // Scroll to a specific tab index
  const scrollToTab = (index) => {
    if (scrollContainerRef.current) {
      const containerWidth = scrollContainerRef.current.offsetWidth;
      scrollContainerRef.current.scrollTo({
        left: index * containerWidth,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar (unchanged) */}
      <Sidebar />

      {/* Mobile: swipeable tab pages */}
      <div className="flex-1 lg:ml-64 h-screen overflow-hidden relative">
        {/* Mobile top bar (unchanged) */}
        <div className="lg:hidden flex items-center px-4 py-3 border-b border-border bg-card sticky top-0 z-30">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Bike className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold text-foreground">Scootlink</span>
          </Link>
        </div>

        {/* Desktop: regular router – hidden on mobile */}
        <div className="hidden lg:block h-full overflow-y-auto pb-20 lg:pb-0">
          <Outlet />
        </div>

        {/* Mobile: swipeable container – visible only on small screens */}
        <div
          ref={scrollContainerRef}
          className="lg:hidden h-[calc(100vh-120px)] overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="flex h-full">
            {tabs.map((tab, index) => (
              <div
                key={tab.key}
                className="snap-start w-[100vw] flex-shrink-0 h-full overflow-y-auto pb-20"
                style={{ scrollSnapAlign: 'start' }}
              >
                {tab.component}
              </div>
            ))}
          </div>
        </div>

        {/* Mobile bottom navigation – passes scroll function */}
        <MobileNav accountType={accountType} onScrollToTab={scrollToTab} />
      </div>
    </div>
  );
}

// Helper: choose the correct Search component based on plan
function getSearchComponent(accountType) {
  if (accountType === 'owner') return <FindDrivers />;
  if (accountType === 'both') return <SearchPage />;
  return <SearchVehicles />;
}

function getSearchPath(accountType) {
  if (accountType === 'owner') return '/find-drivers';
  if (accountType === 'both') return '/mysearch';
  return '/search-vehicles';
}
