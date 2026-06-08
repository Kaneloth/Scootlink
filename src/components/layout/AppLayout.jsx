import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike, User, Settings, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase, saveBiometricRefreshToken } from '@/api/supabaseData';

// ─── Import page components for the five main tabs ────────────────────────
import HomePage from '@/pages/Home';
import SearchPage from '@/pages/SearchPage';
import TrackingPage from '@/pages/TrackingPage';
import BriefcasePage from '@/pages/Briefcase';
import MessagesPage from '@/pages/Messages';

// Must match bottom nav order exactly
const TAB_ORDER = ['/', '/search-vehicles', '/tracking', '/briefcase', '/messages'];

const TABS = [
  { path: '/',              component: HomePage,      icon: Bike, label: 'Home' },
  { path: '/search-vehicles', component: SearchPage,   icon: Bike, label: 'Search' },
  { path: '/tracking',      component: TrackingPage,   icon: Bike, label: 'Track' },
  { path: '/briefcase',        component: BriefcasePage,     icon: Bike, label: 'Briefcase' },
  { path: '/messages',      component: MessagesPage,   icon: Bike, label: 'Messages' },
];

const TAB_PATHS = TABS.map(t => t.path);
const THRESHOLD = 0.3; // 30% of screen width triggers snap

// ─── Navigation progress bar (unchanged) ──────────────────────────────────
function useNavigationProgress(pathname) { /* … same as before … */ }
function NavigationProgressBar({ pathname }) { /* … same as before … */ }

// ─── Verification gate (unchanged) ────────────────────────────────────────
const GATE_EXEMPT = ['/onboarding', '/subscription', '/settings', '/profile'];
const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];
function VerificationGate({ user, userLoading, children }) { /* … same as before … */ }

// ─── Shared biometric-aware logout (unchanged) ────────────────────────────
async function layoutLogout(navigate) { /* … same as before … */ }

// ─── Mobile header with profile dropdown (unchanged) ──────────────────────
function MobileHeader() { /* … same as before … */ }

// ─── Main layout ──────────────────────────────────────────────────────────
export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [gateUser, setGateUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [isBlacklisted, setIsBlacklisted] = useState(false);

  // ── Strip swipe state ──────────────────────────────────────────────────
  const isTabRoute = TAB_PATHS.includes(location.pathname);
  const tabIndex = isTabRoute ? TAB_PATHS.indexOf(location.pathname) : 0;
  const [dragPercent, setDragPercent] = useState(0);
  const isDragging = dragPercent !== 0;
  const touchRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const stripRef = useRef(null);

  const mainRef = useRef(null);
  const accountTypeRef = useRef('driver');
  useEffect(() => { accountTypeRef.current = accountType; }, [accountType]);

  // ── Touch handlers (identical to Base44) ────────────────────────────────
  const onTouchStart = useCallback((e) => {
    if (!isTabRoute) return;
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      active: true,
      axisLocked: false,
      horizontal: false,
    };
  }, [isTabRoute]);

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
    // Rubber-band at edges
    if (pct > 0 && tabIndex === 0) pct *= 0.15;
    if (pct < 0 && tabIndex === TAB_PATHS.length - 1) pct *= 0.15;

    setDragPercent(pct);
  }, [tabIndex]);

  const onTouchEnd = useCallback(() => {
    const t = touchRef.current;
    t.active = false;
    if (!t.horizontal) return;

    if (dragPercent < -(THRESHOLD * 100) && tabIndex < TAB_PATHS.length - 1) {
      navigate(TAB_PATHS[tabIndex + 1]);
    } else if (dragPercent > (THRESHOLD * 100) && tabIndex > 0) {
      navigate(TAB_PATHS[tabIndex - 1]);
    }

    setDragPercent(0);
  }, [dragPercent, tabIndex, navigate]);

  // Reset drag when path changes
  useEffect(() => {
    setDragPercent(0);
  }, [location.pathname]);

  // ── Strip translation (identical to Base44) ─────────────────────────────
  const N = TAB_PATHS.length;
  const baseX = -(tabIndex / N) * 100;
  const dragX = (dragPercent / 100) * (100 / N);
  const stripX = baseX + dragX;

  // ── Existing user loading & blacklist check (unchanged) ─────────────────
  useEffect(() => {
    auth.me().then(async (user) => {
      setAccountType(user?.subscription_active ? (user?.subscription_plan || 'driver') : 'both');
      if (user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('blacklisted')
          .eq('id', user.id)
          .single();
        if (profile?.blacklisted) {
          try { await supabase.auth.signOut(); } catch { /* non-fatal */ }
          setIsBlacklisted(true);
          setUserLoading(false);
          return;
        }
      }
      setGateUser(user ?? null);
    }).catch(() => {}).finally(() => setUserLoading(false));
  }, []);

  // ── Biometric token refresh (unchanged) ─────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
          session?.refresh_token &&
          localStorage.getItem('scootlink_signin_method') === 'biometric') {
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

  // ── Blacklisted screen (unchanged) ──────────────────────────────────────
  if (isBlacklisted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-background to-red-50/30 flex items-center justify-center p-6">
        {/* … same as before … */}
      </div>
    );
  }

  return (
    <VerificationGate user={gateUser} userLoading={userLoading}>
      <div className="flex min-h-screen bg-background">
        <NavigationProgressBar pathname={location.pathname} />
        <Sidebar />

        <div className="relative flex-1 lg:ml-64 overflow-hidden flex flex-col h-screen">
          <MobileHeader />

          {/* ── Swipeable strip or normal outlet ──────────────────────── */}
          <div
            ref={stripRef}
            className="flex-1 min-h-0 overflow-hidden relative"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ touchAction: 'pan-y' }}
          >
            {isTabRoute ? (
              <div
                className="absolute inset-0 flex"
                style={{
                  width: `${N * 100}%`,
                  transform: `translateX(${stripX}%)`,
                  transition: isDragging ? 'none' : 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  willChange: 'transform',
                }}
              >
                {TABS.map(({ path, component: Page }, i) => {
                  const isVisible = Math.abs(i - tabIndex) <= 1;
                  return (
                    <div
                      key={path}
                      className="h-full overflow-y-auto pb-20 lg:pb-0"
                      style={{ width: `${100 / N}%`, flexShrink: 0 }}
                    >
                      {isVisible ? <Page /> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="scroll-container h-full overflow-y-auto pb-20 lg:pb-0">
                <Outlet />
              </div>
            )}
          </div>
        </div>

        <MobileNav />
      </div>
    </VerificationGate>
  );
}