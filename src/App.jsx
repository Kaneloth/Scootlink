import React, { useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';

import Auth from '@/pages/Auth';
import LandingPage from '@/pages/LandingPage';
import Dashboard from '@/pages/Dashboard';
import Credits from '@/pages/Credits';
import Wallet from '@/pages/Wallet';
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
import Messages from '@/pages/Messages';
import ContactUs from '@/pages/ContactUs';

function App() {
  // Register PASSWORD_RECOVERY listener before any component mounts
  React.useMemo(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('skootlink_recovery', '1');
      }
    });
    return subscription;
  }, []);

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
          <Routes>
            {/* Public routes — no auth required */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<Auth />} />

            {/* App routes — AppLayout handles auth gating */}
            <Route element={<AppLayout />}>
              <Route path="/home" element={<Dashboard />} />
              <Route path="/search-vehicles" element={<SearchVehicles />} />
              <Route path="/find-drivers" element={<FindDrivers />} />
              <Route path="/add-vehicle" element={<AddVehicle />} />
              <Route path="/edit-vehicle" element={<EditVehicle />} />
              <Route path="/rental-request" element={<RentalRequest />} />
              <Route path="/tracking" element={<Tracking />} />
              <Route path="/briefcase" element={<MyBriefcase />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/mysearch" element={<SearchPage />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/contact" element={<ContactUs />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/credits" element={<Credits />} />
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