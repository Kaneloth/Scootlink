import React, { useEffect, useMemo } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
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
