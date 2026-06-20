import React, { useEffect, useState } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';

import Auth from '@/pages/Auth';
import LandingPage from '@/pages/LandingPage';
import AppLayout from '@/components/layout/AppLayout';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';
import SearchPage from '@/pages/SearchPage';
import AddVehicle from '@/pages/AddVehicle';
import EditVehicle from '@/pages/EditVehicle';
import RentalRequest from '@/pages/RentalRequest';
import Tracking from '@/pages/Tracking';
import MyBriefcase from '@/pages/MyBriefcase';
import Settings from '@/pages/Settings';
import Profile from '@/pages/Profile';
import Onboarding from '@/pages/Onboarding';
import Subscription from '@/pages/Subscription';
import Messages from '@/pages/Messages';
import ContactUs from '@/pages/ContactUs';

function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Listen for PASSWORD_RECOVERY event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('skootlink_recovery', '1');
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AppRoutes />
          <Toaster />
          <SonnerToaster position="top-center" richColors />
        </Router>
      </QueryClientProvider>
    </AuthProvider>
  );
}

// Separate component so it can use router hooks
function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasOAuthCode = params.has('code');

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && location.pathname === '/auth') {
        const isBiometricLock = localStorage.getItem('scootlink_signin_method') === 'biometric';
        if (!isBiometricLock) {
          navigate('/', { replace: true });
        }
      }
      // Don't mark ready yet if we're mid-OAuth exchange — wait for
      // onAuthStateChange to fire with the real session instead.
      if (!hasOAuthCode) {
        setAuthReady(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (location.pathname === '/auth') {
          const isBiometricLock = localStorage.getItem('scootlink_signin_method') === 'biometric';
          if (!isBiometricLock) {
            navigate('/', { replace: true });
          }
        }
      }
      // Always mark auth as ready once we have a definitive state —
      // covers both normal flow and post-OAuth-exchange SIGNED_IN.
      setAuthReady(true);
    });

    return () => subscription?.unsubscribe();
  }, [navigate, location.pathname]);

  // Show a brief loading screen while checking the session
  if (!authReady) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-background gap-4">
        <img
          src="/favicon.png"
          alt="Skootlink"
          className="w-16 h-16 rounded-2xl shadow-lg animate-pulse"
        />
        <p className="text-sm text-muted-foreground font-medium">Loading Skootlink…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/app" element={<Navigate to="/" replace />} />

      {/* LandingPage lives outside AppLayout — shown to unauthenticated visitors at /landing */}
      <Route path="/landing" element={<LandingPage />} />

      {/* Single AppLayout instance covers ALL app routes */}
      <Route element={<AppLayout />}>
        <Route index element={null} />
        <Route path="/search-vehicles" element={<SearchVehicles />} />
        <Route path="/find-drivers" element={<FindDrivers />} />
        <Route path="/add-vehicle" element={<AddVehicle />} />
        <Route path="/edit-vehicle" element={<EditVehicle />} />
        <Route path="/rental-request" element={<RentalRequest />} />
        <Route path="/tracking" element={<Tracking />} />
        <Route path="/briefcase" element={<MyBriefcase />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/mysearch" element={<SearchPage />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/contact" element={<ContactUs />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/subscription" element={<Subscription />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
}

export default App;