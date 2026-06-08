import React, { useEffect, useState } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
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

/* ── Smart root route: show landing if not logged in, else the full app ── */
const RootRoute = () => {
  const [authState, setAuthState] = useState({ loading: true, user: null });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthState({ loading: false, user: session?.user ?? null });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState({ loading: false, user: session?.user ?? null });
    });

    return () => subscription?.unsubscribe();
  }, []);

  // Show a spinner while auth is being checked
  if (authState.loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated → show landing page
  if (!authState.user) {
    return <LandingPage />;
  }

  // Authenticated → render the full app with the swipeable strip
  // (Dashboard is automatically shown for path '/' because it is in TABS)
  return <AppLayout />;
};

function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

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
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route path="/auth" element={<Auth />} />

            {/* All other authenticated pages – rendered inside AppLayout via Outlet */}
            <Route element={<AppLayout />}>
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
        </Router>
        <Toaster />
        <SonnerToaster position="top-center" richColors />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;