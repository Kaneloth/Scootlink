import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Bike, User, Settings, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase, saveBiometricRefreshToken } from '@/api/supabaseData';

// ─── Import all tab page components ─────────────────────────────────────────
import HomePage from '@/pages/Home';
import SearchPage from '@/pages/SearchPage';
import TrackingPage from '@/pages/TrackingPage';
import WalletPage from '@/pages/Wallet';
import MessagesPage from '@/pages/Messages';

// ─── Tab configuration ──────────────────────────────────────────────────────
const TABS = [
  { path: '/',              component: HomePage,      icon: Bike,      label: 'Home'     },
  { path: '/search-vehicles', component: SearchPage,   icon: Bike,      label: 'Search'   }, // Replace icons as needed
  { path: '/tracking',      component: TrackingPage,   icon: Bike,      label: 'Track'    },
  { path: '/wallet',        component: WalletPage,     icon: Bike,      label: 'Wallet'   },
  { path: '/messages',      component: MessagesPage,   icon: Bike,      label: 'Messages' },
];

const TAB_PATHS = TABS.map(t => t.path);
const THRESHOLD = 0.3; // 30% of screen width

// ─── Navigation progress bar (unchanged) ────────────────────────────────────
function useNavigationProgress(pathname) { /* ... same as before ... */ }
function NavigationProgressBar({ pathname }) { /* ... same as before ... */ }

// ─── Verification gate (unchanged) ──────────────────────────────────────────
const GATE_EXEMPT = ['/onboarding', '/subscription', '/settings', '/profile'];
const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];
function VerificationGate({ user, userLoading, children }) { /* ... same as before ... */ }

// ─── Shared biometric-aware logout (unchanged) ──────────────────────────────
async function layoutLogout(navigate) { /* ... same as before ... */ }

// ─── Mobile header (unchanged) ──────────────────────────────────────────────
function MobileHeader() { /* ... same as before ... */ }

// ─── Main layout ────────────────────────────────────────────────────────────
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [gateUser, setGateUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [isBlacklisted, setIsBlacklisted] = useState(false);

  // ── Swipeable strip state ─────────────────────────────────────────────────
  const initialIndex = TAB_PATHS.indexOf(location.pathname);
  const [tabIndex, setTabIndex] = useState(initialIndex !== -1 ? initialIndex : 0);
  const [dragPercent, setDragPercent] = useState(0);
  const touchRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const stripRef = useRef(null);

  // Sync tabIndex when the URL changes (e.g., back button)
  useEffect(() => {
    const idx = TAB_PATHS.indexOf(location.pathname);
    if (idx !== -1 && idx !== tabIndex) {
      setTabIndex(idx);
    }
  }, [location.pathname]);

  // ── Touch handlers (exactly like the CV builder) ─────────────────────────
  const onTouchStart = useCallback((e) => {
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      active: true,
      axisLocked: false,
      horizontal: false,
    };
  }, []);

  const onTouchMove = useCallback((e) => {
    const t = touchRef.current;
    if (!t.active) return;

    const dx = e.touches[0].clientX - t.startX;
    const dy = e.touches[0].clientY - t.startY;

    if (!t.axisLocked) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      t.axisLocked = true;
      t.horizontal = Math.abs(dx) > Math.abs(dy);
    }

    if (!t.horizontal) return;
    e.preventDefault();

    let pct = (dx / window.innerWidth) * 100;
    if (pct > 0 && tabIndex === 0) pct *= 0.15;
    if (pct < 0 && tabIndex === TABS.length - 1) pct *= 0.15;

    setDragPercent(pct);
  }, [tabIndex]);

  const onTouchEnd = useCallback(() => {
    const t = touchRef.current;
    t.active = false;
    if (!t.horizontal) return;

    if (dragPercent < -(THRESHOLD * 100) && tabIndex < TABS.length - 1) {
      const nextIndex = tabIndex + 1;
      setTabIndex(nextIndex);
      navigate(TAB_PATHS[nextIndex]); // update URL
    } else if (dragPercent > (THRESHOLD * 100) && tabIndex > 0) {
      const prevIndex = tabIndex - 1;
      setTabIndex(prevIndex);
      navigate(TAB_PATHS[prevIndex]);
    }

    setDragPercent(0);
  }, [dragPercent, tabIndex, navigate]);

  // ── Strip translation (exactly like CV builder) ──────────────────────────
  const N = TABS.length;
  const baseX = -(tabIndex / N) * 100; // center active tab
  const dragX = (dragPercent / 100) * (100 / N); // drag offset in strip‑%
  const stripX = baseX + dragX;

  // ── Existing user loading & blacklist check (unchanged) ──────────────────
  useEffect(() => { /* ... same ... */ }, []);

  // ── Render blacklisted screen (unchanged) ─────────────────────────────────
  if (isBlacklisted) { /* ... same ... */ }

  return (
    <VerificationGate user={gateUser} userLoading={userLoading}>
      <div className="flex min-h-screen bg-background">
        <NavigationProgressBar pathname={location.pathname} />
        <Sidebar />

        <div className="relative flex-1 lg:ml-64 overflow-hidden flex flex-col h-screen">
          <MobileHeader />

          {/* ── Swipeable strip container ──────────────────────────────── */}
          <div
            ref={stripRef}
            className="flex-1 min-h-0 overflow-hidden relative"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div
              className="flex h-full transition-none"
              style={{
                width: `${N * 100}%`,
                transform: `translateX(${stripX}%)`,
                transition: dragPercent === 0 ? 'transform 0.3s ease-out' : 'none',
              }}
            >
              {TABS.map((tab, i) => (
                <div key={tab.path} className="w-full h-full overflow-y-auto">
                  <tab.component />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bottom nav (click sets tabIndex + updates URL) ──────────── */}
        <MobileNav
          activeIndex={tabIndex}
          onTabChange={(index) => {
            setTabIndex(index);
            navigate(TAB_PATHS[index]);
          }}
        />
      </div>
    </VerificationGate>
  );
}