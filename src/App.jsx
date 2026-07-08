import React, { useEffect, useMemo, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster, toast } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';

import Auth from '@/pages/Auth';
import LandingPage from '@/pages/LandingPage';
import Credits from '@/pages/Credits';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';
import SearchPage from '@/pages/SearchPage';
import AddVehicle from '@/pages/AddVehicle';
import RentalRequest from '@/pages/RentalRequest';
import Activity from '@/pages/Activity';
import MyBriefcase from '@/pages/MyBriefcase';
import Settings from '@/pages/Settings';
import Profile from '@/pages/Profile';
import Onboarding from '@/pages/Onboarding';

import Messages from '@/pages/Messages';
import ContactUs from '@/pages/ContactUs';

// __INCLUDE_ADMIN__ is replaced with a literal `true`/`false` at build time
// (see vite.config.js). For `npm run build:native`, it's `false`, and the
// ternary below lets esbuild/Rollup prove the import() calls are dead code
// and drop them entirely — the admin dashboard never ends up in the APK.
// The regular web build (`npm run build`) keeps them as normal lazy chunks.
const AdminLayout = __INCLUDE_ADMIN__ ? React.lazy(() => import('@/pages/admin/AdminLayout')) : null;
const AdminOverview = __INCLUDE_ADMIN__ ? React.lazy(() => import('@/pages/admin/AdminOverview')) : null;
const AdminUserManagement = __INCLUDE_ADMIN__ ? React.lazy(() => import('@/pages/admin/AdminUserManagement')) : null;
const AdminRentalsOversight = __INCLUDE_ADMIN__ ? React.lazy(() => import('@/pages/admin/AdminRentalsOversight')) : null;
const AdminPlatformVerification = __INCLUDE_ADMIN__ ? React.lazy(() => import('@/pages/admin/AdminPlatformVerification')) : null;

function AdminLoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

const AuthenticatedApp = () => {
  const [supabaseChecked, setSupabaseChecked] = React.useState(false);

  React.useEffect(() => {
    const path = window.location.pathname;
    const publicPaths = ['/', '/auth'];

    // Safety net — never stay stuck beyond 5 seconds
    const timer = setTimeout(() => setSupabaseChecked(true), 5000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timer);
      const isRecovery = sessionStorage.getItem('skootlink_recovery') === '1';

      if (isRecovery) {
        if (path !== '/auth') { window.location.replace('/auth'); }
        else { setSupabaseChecked(true); }
      } else if (session && (path === '/auth' || path === '/')) {
        window.location.replace('/home');
      } else if (!session && !publicPaths.includes(path)) {
        window.location.replace('/auth');
      } else {
        setSupabaseChecked(true);
      }
    }).catch(() => {
      clearTimeout(timer);
      setSupabaseChecked(true);
    });

    return () => clearTimeout(timer);
  }, []);

  if (!supabaseChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <p className="text-sm text-muted-foreground font-medium">Loading Skootlink...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public — no auth */}
      <Route path="/" element={<LandingPage />} />

      {/* Auth */}
      <Route path="/auth" element={<Auth />} />

      {/* Full-screen flows (no sidebar) */}
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/credits" element={<Credits />} />

      {/* Main app with layout */}
      <Route element={<AppLayout />}>
        <Route path="/home" element={<Dashboard />} />
        <Route path="/search-vehicles" element={<SearchVehicles />} />
        <Route path="/find-drivers" element={<FindDrivers />} />
        <Route path="/add-vehicle" element={<AddVehicle />} />
        <Route path="/edit-vehicle" element={<AddVehicle />} />
        <Route path="/rental-request" element={<RentalRequest />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/briefcase" element={<MyBriefcase />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/mysearch" element={<SearchPage />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/contact" element={<ContactUs />} />
      </Route>

      {/* Admin dashboard — reachable as a normal web URL (skootlink.co.za/admin),
          entirely absent from native builds (see vite.config.js / package.json
          build:native). __INCLUDE_ADMIN__ is a compile-time literal, so this
          whole block is dead code and gets stripped for the native build. */}
      {__INCLUDE_ADMIN__ && (
        <Route
          path="/admin"
          element={
            <Suspense fallback={<AdminLoadingScreen />}>
              <AdminLayout />
            </Suspense>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUserManagement />} />
          <Route path="rentals" element={<AdminRentalsOversight />} />
          <Route path="platform-verification" element={<AdminPlatformVerification />} />
        </Route>
      )}

      {/* Redirect legacy /dashboard to /home */}
      <Route path="/dashboard" element={<Navigate to="/home" replace />} />

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  // Register the PASSWORD_RECOVERY listener as early as possible — useMemo runs
  // synchronously during render, before any child component mounts. This ensures
  // we catch the event even if Supabase fires it before Auth.jsx is mounted.
  // The flag is stored in sessionStorage so it survives React Router navigation.
  useMemo(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('skootlink_recovery', '1');
      }
    });
    // Not cleaning up here intentionally — this listener must live for the
    // entire app session so it catches the event regardless of which component
    // is mounted at the time.
    return subscription;
  }, []);

  // Apply saved theme on initial load
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Initialize the native status bar — a no-op on the website (guarded by
  // isNativePlatform), but on Android this reserves the status bar's own
  // space instead of letting the WebView draw underneath it, and sets the
  // icon color to match the current theme so they're actually visible.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const isDark = document.documentElement.classList.contains('dark');
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: isDark ? '#0f172a' : '#ffffff' }).catch(() => {});
  }, []);

  // Global appUrlOpen listener - registered here (not in Auth.jsx) so it
  // stays active regardless of which page is currently mounted during the
  // OAuth flow. Handles the custom-scheme redirect (co.za.skootlink.app://auth)
  // that Google/Supabase send back to, closing the in-app browser and
  // completing sign-in once the code is exchanged for a session.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener;
    (async () => {
      try {
        const capacitorAppPkg = '@' + 'capacitor/app';
        const { App: CapApp } = await import(/* @vite-ignore */ capacitorAppPkg);
        listener = await CapApp.addListener('appUrlOpen', async ({ url }) => {
          try {
            const parsed = new URL(url);
            const code = parsed.searchParams.get('code');
            if (code) {
              await supabase.auth.exchangeCodeForSession(code);
            } else {
              const params = new URLSearchParams(parsed.hash.replace('#', ''));
              const accessToken = params.get('access_token');
              const refreshToken = params.get('refresh_token');
              if (accessToken && refreshToken) {
                await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
              }
            }
            const capacitorBrowserPkg = '@' + 'capacitor/browser';
            const { Browser } = await import(/* @vite-ignore */ capacitorBrowserPkg);
            await Browser.close().catch(() => {});
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* not in Capacitor environment */ }
    })();
    return () => { if (listener) { listener.remove().catch(() => {}); } };
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster position="top-center" richColors />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App;
