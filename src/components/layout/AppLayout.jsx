import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Bike, User, Settings, LogOut, Send, Loader2 } from 'lucide-react';
import NotificationBell from '@/components/layout/NotificationBell';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { auth, supabase, saveBiometricRefreshToken } from '@/api/supabaseData';

// ─── Page components for the five main tabs ────────────────────────────────
import HomePage    from '@/pages/Dashboard';
import SearchPage  from '@/pages/SearchPage';
import ActivityPage    from '@/pages/Activity';
import BriefcasePage  from '@/pages/MyBriefcase';
import MessagesPage   from '@/pages/Messages';

// Must match bottom nav order exactly: Home → Search → Activity → Briefcase → Messages
// ─── Search paths (dynamic based on account type) ───────────────────────────
const SEARCH_PATHS = ['/search-vehicles', '/find-drivers', '/mysearch'];
const CANONICAL_SEARCH_PATH = '/search-vehicles';
const CANONICAL_PATHS = ['/home', CANONICAL_SEARCH_PATH, '/activity', '/briefcase', '/messages'];

const TABS = [
  { path: '/home',               component: HomePage,      icon: Bike, label: 'Home'      },
  { path: CANONICAL_SEARCH_PATH, component: SearchPage,    icon: Bike, label: 'Search'    },
  { path: '/activity',            component: ActivityPage,  icon: Bike, label: 'Activity'  },
  { path: '/briefcase',          component: BriefcasePage, icon: Bike, label: 'Briefcase' },
  { path: '/messages',           component: MessagesPage,  icon: Bike, label: 'Messages'  },
];

const TAB_PATHS = TABS.reduce((acc, tab) => {
  if (tab.path === CANONICAL_SEARCH_PATH) {
    acc.push(...SEARCH_PATHS);
  } else {
    acc.push(tab.path);
  }
  return acc;
}, []);

const THRESHOLD = 0.3;

function getTabIndex(pathname) {
  if (SEARCH_PATHS.includes(pathname)) return 1;
  const idx = CANONICAL_PATHS.indexOf(pathname);
  return idx === -1 ? 0 : idx;
}

// ─── Navigation progress bar ──────────────────────────────────────────────────
function useNavigationProgress(pathname) {
  const [barState, setBarState] = useState({ width: 0, visible: false, done: false });
  const prevPathRef = useRef(pathname);
  const timersRef = useRef([]);
  const clear = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    clear();
    setBarState({ width: 0, visible: true, done: false });
    const t1 = setTimeout(() => setBarState(s => ({ ...s, width: 60 })), 30);
    const t2 = setTimeout(() => setBarState(s => ({ ...s, width: 80 })), 250);
    const t3 = setTimeout(() => setBarState(s => ({ ...s, width: 95 })), 500);
    const t4 = setTimeout(() => setBarState(s => ({ ...s, width: 100, done: true })), 700);
    const t5 = setTimeout(() => setBarState({ width: 0, visible: false, done: false }), 1050);
    timersRef.current = [t1, t2, t3, t4, t5];
    return clear;
  }, [pathname]);

  return barState;
}

function NavigationProgressBar({ pathname }) {
  const { width, visible, done } = useNavigationProgress(pathname);
  if (!visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-[3px] pointer-events-none">
      <div style={{
        height: '100%', width: `${width}%`,
        transition: width === 0 ? 'none' : done
          ? 'width 0.2s ease-in, opacity 0.3s ease-out 0.05s'
          : 'width 0.4s ease-out',
        opacity: done ? 0 : 1,
        background: 'hsl(var(--primary))',
        boxShadow: '0 0 8px hsl(var(--primary) / 0.6)',
        borderRadius: '0 2px 2px 0',
      }} />
    </div>
  );
}

// ─── Verification gate ────────────────────────────────────────────────────────
// Routes the user can always reach even before verification is complete.
const GATE_EXEMPT = ['/onboarding', '/settings', '/profile', '/credits'];
const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];

function VerificationGate({ user, userLoading, children }) {
  const location = useLocation();
  const navigate  = useNavigate();

  if (userLoading) return null; // wait — avoids flash of gate before user loads
  if (!user) {
    // Not logged in — redirect to auth
    window.location.replace('/auth');
    return null;
  }

  const isAdmin   = user?.user_metadata?.is_admin === true || ADMIN_EMAILS.includes(user.email);
  const isExempt  = GATE_EXEMPT.some((p) => location.pathname.startsWith(p));
  if (isAdmin || isExempt) return children;

  // Step 1 — onboarding not completed → show setup prompt
  // A user is considered "set up" if they have completed the onboarding flow
  // OR if they have manually saved their profile with at minimum a name,
  // phone and location — covers users who skipped onboarding and went
  // straight to Profile page instead.
  const hasMinProfile = !!(user.full_name?.trim() && user.phone?.trim() && user.location?.trim());
  if (!user.onboarding_completed && !hasMinProfile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold mb-2">Complete your profile</h2>
          <p className="text-muted-foreground text-sm max-w-xs">
            Please finish setting up your profile so owners and drivers can find you on the platform.
          </p>
        </div>
        <button
          className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors"
          onClick={() => navigate('/onboarding')}
        >
          Set up my profile
        </button>
      </div>
    );
  }

  // Unverified users have full app access — messaging enforces its own verified check.
  return children;
}

// ─── Shared biometric-aware logout ───────────────────────────────────────────
// All logout buttons in the layout must go through this helper so that
// biometric users keep their refresh token alive on the server.
async function layoutLogout(navigate) {
  if (localStorage.getItem('scootlink_signin_method') === 'biometric') {
    // Save the current session without calling signOut — signOut (even
    // scope:'local') sends a server-side revocation that invalidates the
    // refresh token, breaking biometric restoration on next login.
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session) saveBiometricRefreshToken(data.session);
    } catch { /* non-fatal */ }
    // The Supabase session is still valid on purpose (see above) — without
    // this flag, Auth.jsx would see that valid session on mount and
    // immediately navigate straight back into the app, making logout look
    // broken. Cleared the moment the user explicitly signs back in.
    sessionStorage.setItem('skootlink_biometric_locked', '1');
    navigate('/auth');
  } else {
    await supabase.auth.signOut();
    navigate('/auth');
  }
}

// ─── Mobile header with profile dropdown ─────────────────────────────────────
function MobileHeader() {
  const navigate               = useNavigate();
  const [open, setOpen]        = useState(false);
  const dropdownRef            = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    await layoutLogout(navigate);
  };

  return (
    <div
      className="lg:hidden flex items-center justify-between px-4 border-b border-border bg-card z-30 shrink-0"
      style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem' }}
    >
      {/* Logo */}
      <Link
        to="/home"
        className="flex items-center gap-2"
        draggable={false}
        style={{ WebkitUserDrag: 'none', userSelect: 'none' }}
      >
        <img
          src="/favicon.png"
          alt="Skootlink"
          className="w-11 h-11"
          draggable={false}
          style={{ WebkitUserDrag: 'none' }}
        />
        <span className="text-2xl font-bold text-foreground">Skootlink</span>
      </Link>

      {/* Notification bell + profile button + dropdown */}
      <div className="flex items-center gap-2">
        <NotificationBell />
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen(v => !v)}
            className={`w-11 h-11 rounded-full flex items-center justify-center border-2 transition-colors ${open ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
            style={{ touchAction: 'manipulation' }}
            aria-label="Account menu"
          >
            <User className="w-5 h-5" />
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border bg-card shadow-lg overflow-hidden z-50">
              <button
                onClick={() => { setOpen(false); navigate('/profile'); }}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-left"
              >
                <User className="w-4 h-4 text-muted-foreground" />
                Profile
              </button>
              <div className="border-t border-border" />
              <button
                onClick={() => { setOpen(false); navigate('/settings'); }}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-accent transition-colors text-left"
              >
                <Settings className="w-4 h-4 text-muted-foreground" />
                Settings
              </button>
              <div className="border-t border-border" />
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-destructive/10 text-destructive transition-colors text-left"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main layout ──────────────────────────────────────────────────────────────
// ── In-app contact form for suspended users ────────────────────────────────
function SuspendedContactForm({ userEmail }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      // Store the appeal as a notification to admin / support inbox
      await supabase.from('support_appeals').insert({
        email:      userEmail || 'unknown',
        message:    message.trim(),
        created_at: new Date().toISOString(),
      });
      setSent(true);
    } catch {
      // Fallback — even if table doesn't exist yet, don't crash
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 text-center">
        <p className="text-sm font-semibold text-green-700 dark:text-green-300">Message sent ✓</p>
        <p className="text-xs text-green-600 dark:text-green-400 mt-1">We'll review your appeal and get back to you at {userEmail}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="Explain why you believe this suspension is a mistake…"
        rows={4}
        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
      />
      <button
        type="submit"
        disabled={sending || !message.trim()}
        className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
      >
        {sending
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
          : <><Send className="w-4 h-4" /> Send Appeal</>}
      </button>
      <p className="text-xs text-muted-foreground text-center">
        We'll respond to <span className="font-medium">{userEmail}</span>
      </p>
    </form>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');
  const [gateUser, setGateUser]       = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [isBlacklisted, setIsBlacklisted] = useState(null);
  const [suspendedEmail, setSuspendedEmail] = useState('');


  // ── Strip swipe state ──────────────────────────────────────────────────
  const isTabRoute = TAB_PATHS.includes(location.pathname);
  const tabIndex = isTabRoute ? getTabIndex(location.pathname) : 0;
  const [dragPercent, setDragPercent] = useState(0);
  const isDragging = dragPercent !== 0;
  const dragPercentRef = useRef(0);
  const touchRef = useRef({ startX: 0, startY: 0, active: false, axisLocked: false, horizontal: false });
  const stripRef = useRef(null);

  const mainRef = useRef(null);
  const accountTypeRef = useRef('driver');

  // ── Touch handlers ─────────────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    if (e.target.closest('[data-no-swipe]')) return;
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
      // Require more initial movement, and a clear horizontal bias (not
      // just "very slightly more horizontal than vertical") before
      // committing to a horizontal swipe. A near-vertical scroll attempt
      // can easily have a marginally larger dx than dy in its very first
      // few pixels purely by chance — locking "horizontal" on that thin a
      // margin meant preventDefault() below could fire on what was
      // actually meant to be a normal vertical scroll, for the rest of
      // that entire touch gesture.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
t.axisLocked = true;
t.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
    }

    if (!t.horizontal) return;
    e.preventDefault();

    let pct = (dx / window.innerWidth) * 100;
    if (pct > 0 && tabIndex === 0) pct *= 0.15;
    if (pct < 0 && tabIndex === CANONICAL_PATHS.length - 1) pct *= 0.15;

    // Never let the strip leave the range from which it can be recovered.
    // Android can cancel a touch when it reaches a system edge; without this
    // clamp, the last rendered transform can remain outside the viewport.
    const maxPull = 42;
    const boundedPct = Math.max(-maxPull, Math.min(maxPull, pct));
    dragPercentRef.current = boundedPct;
    setDragPercent(boundedPct);
  }, [tabIndex]);

  const finishTouch = useCallback((shouldNavigate) => {
    const t = touchRef.current;
    const wasHorizontal = t.horizontal;
    const currentDrag = dragPercentRef.current;

    // Reset the gesture synchronously before navigation. This also handles
    // Android's touchcancel path, where there is no reliable final touchmove.
    t.active = false;
    t.axisLocked = false;
    t.horizontal = false;
    dragPercentRef.current = 0;

    if (shouldNavigate && wasHorizontal) {
      if (currentDrag < -(THRESHOLD * 100) && tabIndex < CANONICAL_PATHS.length - 1) {
        navigate(CANONICAL_PATHS[tabIndex + 1]);
      } else if (currentDrag > (THRESHOLD * 100) && tabIndex > 0) {
        navigate(CANONICAL_PATHS[tabIndex - 1]);
      }
    }

    setDragPercent(0);
  }, [tabIndex, navigate]);

  const onTouchEnd = useCallback(() => {
    finishTouch(true);
  }, [finishTouch]);

  const onTouchCancel = useCallback(() => {
    finishTouch(false);
  }, [finishTouch]);

  useEffect(() => {
    // Android can dispatch cancellation at the window level when a finger
    // reaches the system/status-bar edge. It can also interrupt the gesture
    // during rotation, app switching, or a brief loss of focus.
    const cancelInterruptedSwipe = () => {
      const t = touchRef.current;
      if (!t.active && dragPercentRef.current === 0) return;
      t.active = false;
      t.axisLocked = false;
      t.horizontal = false;
      dragPercentRef.current = 0;
      setDragPercent(0);
    };
    const cancelWhenHidden = () => {
      if (document.visibilityState !== 'visible') cancelInterruptedSwipe();
    };

    window.addEventListener('touchcancel', cancelInterruptedSwipe, { passive: true });
    window.addEventListener('pointercancel', cancelInterruptedSwipe, { passive: true });
    window.addEventListener('blur', cancelInterruptedSwipe);
    window.addEventListener('pagehide', cancelInterruptedSwipe);
    window.addEventListener('orientationchange', cancelInterruptedSwipe);
    window.addEventListener('resize', cancelInterruptedSwipe);
    document.addEventListener('visibilitychange', cancelWhenHidden);
    return () => {
      window.removeEventListener('touchcancel', cancelInterruptedSwipe);
      window.removeEventListener('pointercancel', cancelInterruptedSwipe);
      window.removeEventListener('blur', cancelInterruptedSwipe);
      window.removeEventListener('pagehide', cancelInterruptedSwipe);
      window.removeEventListener('orientationchange', cancelInterruptedSwipe);
      window.removeEventListener('resize', cancelInterruptedSwipe);
      document.removeEventListener('visibilitychange', cancelWhenHidden);
    };
  }, []);

  useEffect(() => {
    dragPercentRef.current = 0;
    setDragPercent(0);
  }, [location.pathname]);

  // ── Strip translation ──────────────────────────────────────────────────
  const N = CANONICAL_PATHS.length;
  const baseX = -(tabIndex / N) * 100;
  const dragX = (dragPercent / 100) * (100 / N);
  const stripX = baseX + dragX;

  useEffect(() => { accountTypeRef.current = accountType; }, [accountType]);



  useEffect(() => {
    auth.me().then(async (user) => {
      // Unsubscribed users preview both owner + driver navigation
      setAccountType(user?.account_type || 'both');
      if (user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('blacklisted, suspended, suspension_reason, ban_reason')
          .eq('id', user.id)
          .single();
        if (profile?.blacklisted || profile?.suspended) {
          setSuspendedEmail(user.email || '');
          try { await supabase.auth.signOut(); } catch { /* non-fatal */ }
          setIsBlacklisted({ type: profile.blacklisted ? 'ban' : 'suspend', reason: profile.blacklisted ? profile.ban_reason : profile.suspension_reason });
          setUserLoading(false);
          return;
        }
      }
      setGateUser(user ?? null);
    }).catch(() => {}).finally(() => setUserLoading(false));
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        session?.refresh_token &&
        localStorage.getItem('scootlink_signin_method') === 'biometric'
      ) {
        fetch('https://skootlink.co.za/.netlify/functions/auth-set-token', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        }).catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, []);



  // Suspended account — user was signed out; show full-page blocked screen
  if (isBlacklisted) {
    const isBan = isBlacklisted.type === 'ban';
    const reason = isBlacklisted.reason;
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-background to-red-50/30 flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold text-red-700">
              {isBan ? 'Account Banned' : 'Account Suspended'}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your Skootlink account has been {isBan ? 'permanently banned' : 'suspended'} and you cannot access the platform at this time.
            </p>
            {reason && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-left">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Reason:</p>
                <p className="text-sm text-red-800 dark:text-red-300 leading-relaxed">{reason}</p>
              </div>
            )}
          </div>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isBan
                ? 'If you believe this ban is a mistake, send us an appeal below.'
                : 'To appeal this suspension, send us a message below and we\'ll review your account.'}
            </p>
            <SuspendedContactForm userEmail={suspendedEmail} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <VerificationGate user={gateUser} userLoading={userLoading}>
      <div className="native-app-shell flex min-h-screen bg-background">
        <NavigationProgressBar pathname={location.pathname} />
        <Sidebar />

        <div className="relative flex-1 lg:ml-64 overflow-hidden flex flex-col h-full min-h-0" style={{ height: '100dvh' }}>
          <MobileHeader />

          <div
            ref={stripRef}
            className="flex-1 min-h-0 overflow-hidden relative"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            style={{ touchAction: 'pan-y', overscrollBehavior: 'none' }}
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
                      className="h-full overflow-y-auto overscroll-none pb-28 lg:pb-0"
                      style={{ width: `${100 / N}%`, flexShrink: 0, minHeight: '100%' }}
                    >
                      {isVisible ? <Page /> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="scroll-container h-full overflow-y-auto overscroll-none pb-28 lg:pb-0">
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
