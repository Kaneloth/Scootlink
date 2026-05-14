import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase } from '@/api/supabaseData';

// Import all main tab components – they will be pre‑rendered for smooth swiping
import Dashboard from '@/pages/Dashboard';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';
import SearchPage from '@/pages/SearchPage';
import Tracking from '@/pages/Tracking';
import Wallet from '@/pages/Wallet';
import Settings from '@/pages/Settings';
import Messages from '@/pages/Messages';

// Tab order and metadata (unchanged from your version)
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

// ─── Navigation progress bar (exactly as you had it) ─────────────────────────
function useNavigationProgress(pathname) { /* unchanged */ }
function NavigationProgressBar({ pathname }) { /* unchanged */ }

// ─── Main layout ──────────────────────────────────────────────────────────────
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [slideClass, setSlideClass] = useState('');

  const mainRef = useRef(null);
  const swipeRef = useRef(null);
  const prevLocationRef = useRef(location.pathname);
  const accountTypeRef = useRef('driver');

  // Tracks the currently active tab index for the bottom nav
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => { accountTypeRef.current = accountType; }, [accountType]);

  // Slide animation when navigating directly (not via swipe) – stays
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

  // Helper to get the correct Search component and path based on plan
  const getSearchComponent = useCallback(() => {
    const plan = accountTypeRef.current;
    if (plan === 'owner') return <FindDrivers />;
    if (plan === 'both') return <SearchPage />;
    return <SearchVehicles />;
  }, []);

  const getSearchPath = useCallback(() => {
    const plan = accountTypeRef.current;
    if (plan === 'owner') return '/find-drivers';
    if (plan === 'both') return '/mysearch';
    return '/search-vehicles';
  }, []);

  // Build the tabs array – order matters for swipe
  const tabs = [
    { component: <Dashboard />, path: '/' },
    { component: getSearchComponent(), path: getSearchPath() },
    { component: <Messages />, path: '/messages' },
    { component: <Tracking />, path: '/tracking' },
    { component: <Wallet />, path: '/wallet' },
    { component: <Settings />, path: '/settings' },
  ];

  // Mapping from path to index (for bottom nav highlight)
  const pathToIndex = {
    '/': 0,
    '/search-vehicles': 1, '/find-drivers': 1, '/mysearch': 1,
    '/messages': 2,
    '/tracking': 3,
    '/wallet': 4,
    '/settings': 5,
  };

  // Sync activeTab from URL (only when on a main tab)
  useEffect(() => {
    if (MAIN_TAB_PATHS.includes(location.pathname)) {
      setActiveTab(pathToIndex[location.pathname] ?? 0);
    }
  }, [location.pathname]);

  // Scroll to a specific tab (used by MobileNav)
  const scrollToTab = useCallback((index) => {
    if (swipeRef.current) {
      const containerWidth = swipeRef.current.offsetWidth;
      swipeRef.current.scrollTo({
        left: index * containerWidth,
        behavior: 'smooth',
      });
    }
  }, []);

  // When the swipe container finishes scrolling, update the URL
  const handleScrollEnd = useCallback(() => {
    if (!swipeRef.current) return;
    const containerWidth = swipeRef.current.offsetWidth;
    const scrollLeft = swipeRef.current.scrollLeft;
    const newIndex = Math.round(scrollLeft / containerWidth);
    const targetPath = tabs[newIndex]?.path;
    if (targetPath && location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
    setActiveTab(newIndex);
  }, [tabs, navigate, location.pathname]);

  // Determine if we are on a main tab (where swiper should be shown)
  const MAIN_TAB_PATHS = ['/', '/search-vehicles', '/find-drivers', '/mysearch', '/messages', '/tracking', '/wallet', '/settings'];
  const isMainTab = MAIN_TAB_PATHS.includes(location.pathname);

  return (
    <div className="flex min-h-screen bg-background">
      <style>{`
        .main-content {
          transition: none !important;
          touch-action: pan-y;               /* vertical scrolling only */
          overscroll-behavior-x: none;       /* prevent horizontal rubber-band */
        }
        .swipe-container {
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
        }
        .swipe-page {
          scroll-snap-align: start;
          width: 100vw;
          flex-shrink: 0;
          height: 100%;
          overflow-y: auto;
          padding-bottom: 5rem;              /* space for bottom nav */
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
        {/* Mobile: swipeable tab pages */}
        <div className="lg:hidden h-full">
          {isMainTab ? (
            <div
              ref={swipeRef}
              className="swipe-container flex overflow-x-auto overflow-y-hidden h-full"
              onScrollEnd={handleScrollEnd}
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {tabs.map((tab, index) => (
                <div key={tab.path} className="swipe-page">
                  {tab.component}
                </div>
              ))}
            </div>
          ) : (
            <main className="h-full overflow-y-auto pb-20">
              <Outlet />
            </main>
          )}
        </div>

        {/* Desktop: normal router – unchanged */}
        <main className="hidden lg:block h-screen overflow-y-auto pb-0">
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

      {/* MobileNav gets activeTab and scrollToTab so it can sync and navigate */}
      <MobileNav activeTab={activeTab} onScrollToTab={scrollToTab} />
    </div>
  );
}