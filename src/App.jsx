import React, { useEffect, useMemo } from 'react';
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

// TODO: replace with your actual Web client ID from Google Cloud Console
// (Supabase Dashboard → Authentication → Providers → Google → Client ID).
// This MUST be the Web client ID on every platform, including Android —
// see https://capawesome.io/docs/sdks/capacitor/google-sign-in/#initializeoptions
const GOOGLE_WEB_CLIENT_ID = '777597551403-o1c521882a048uhk9luvgdpu8qluj0qm.apps.googleusercontent.com';

const AuthenticatedApp = () => {
  const [supabaseChecked, setSupabaseChecked] = React.useState(false);

  React.useEffect(() => {
    const path = window.location.pathname;
    // '/' is only "public" on the web (marketing landing page). A native
    // app cold-starts at '/' too, but there's no landing page concept there —
    // a logged-out native user should always land on /auth, not the website.
    const isNative = Capacitor.isNativePlatform();
    const publicPaths = isNative ? ['/auth'] : ['/', '/auth'];

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

  // Initialize native Google Sign-In (Credential Manager on Android). Must
  // run once before GoogleSignIn.signIn() is ever called from Auth.jsx —
  // this replaces the old Browser/deep-link OAuth flow entirely on native,
  // so there's no Custom Tab, no appUrlOpen round-trip, and no PKCE code
  // exchange to go wrong for Google sign-in specifically.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    (async () => {
      try {
        const { GoogleSignIn } = await import('@capawesome/capacitor-google-sign-in');
        await GoogleSignIn.initialize({ clientId: GOOGLE_WEB_CLIENT_ID });
      } catch (e) {
        console.error('[App] GoogleSignIn.initialize failed:', e);
      }
    })();
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
          let authError = null;
          try {
            const parsed = new URL(url);
            const code = parsed.searchParams.get('code');
            if (code) {
              // exchangeCodeForSession does NOT throw on failure — it resolves
              // with { data, error }. Discarding that return value was the
              // actual cause of the silent bounce-back: a failed exchange
              // (expired/invalid code, PKCE verifier mismatch, etc.) would
              // fall straight through to Browser.close() below with zero
              // indication anything went wrong.
              const { error } = await supabase.auth.exchangeCodeForSession(code);
              authError = error;
            } else {
              const params = new URLSearchParams(parsed.hash.replace('#', ''));
              const accessToken = params.get('access_token');
              const refreshToken = params.get('refresh_token');
              const errorDescription = parsed.searchParams.get('error_description') || params.get('error_description');
              if (accessToken && refreshToken) {
                const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
                authError = error;
              } else if (errorDescription) {
                // Google/Supabase sent back an error instead of tokens
                // (e.g. access_denied, server_error) — surface it directly.
                authError = { message: errorDescription };
              }
            }
            if (authError) {
              console.error('[App] OAuth callback failed:', authError);
              // Auth.jsx can't see this — it happened before that component's
              // own listener ever got a session to react to. Stash it so
              // Auth.jsx can show a real error instead of just reverting
              // silently to the login screen.
              sessionStorage.setItem('skootlink_oauth_error', authError.message || 'Sign-in failed. Please try again.');
            }
          } catch (e) {
            console.error('[App] appUrlOpen handler threw:', e);
            sessionStorage.setItem('skootlink_oauth_error', e?.message || 'Sign-in failed. Please try again.');
          } finally {
            try {
              const capacitorBrowserPkg = '@' + 'capacitor/browser';
              const { Browser } = await import(/* @vite-ignore */ capacitorBrowserPkg);
              await Browser.close().catch(() => {});
            } catch (e) { /* not in Capacitor environment */ }
          }
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
