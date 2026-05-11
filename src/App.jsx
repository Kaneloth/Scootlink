import React, { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';

import Auth from '@/pages/Auth';
import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';
import SearchPage from '@/pages/SearchPage';
import AddVehicle from '@/pages/AddVehicle';
import EditVehicle from '@/pages/EditVehicle';
import RentalRequest from '@/pages/RentalRequest';
import Tracking from '@/pages/Tracking';
import Wallet from '@/pages/Wallet';
import Settings from '@/pages/Settings';
import Profile from '@/pages/Profile';
import Onboarding from '@/pages/Onboarding';
import Subscription from '@/pages/Subscription';
import Messages from '@/pages/Messages';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings } = useAuth();
  const [supabaseChecked, setSupabaseChecked] = React.useState(false);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session && window.location.pathname !== '/auth') {
        window.location.href = '/auth';
      } else {
        setSupabaseChecked(true);
      }
    });
  }, []);

  if (!supabaseChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <p className="text-sm text-muted-foreground font-medium">Loading Scootlink...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Auth */}
      <Route path="/auth" element={<Auth />} />

      {/* Full-screen flows (no sidebar) */}
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/subscription" element={<Subscription />} />

      {/* Main app with layout */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/search-vehicles" element={<SearchVehicles />} />
        <Route path="/find-drivers" element={<FindDrivers />} />
        <Route path="/add-vehicle" element={<AddVehicle />} />
        <Route path="/edit-vehicle" element={<EditVehicle />} />
        <Route path="/rental-request" element={<RentalRequest />} />
        <Route path="/tracking" element={<Tracking />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
       <Route path="/mysearch" element={<SearchPage />} />
        <Route path="/messages" element={<Messages />} />
      </Route>

      <Route path="*" element={<PageNotFound />} />
        </Routes>
  );
};

function App() {
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
