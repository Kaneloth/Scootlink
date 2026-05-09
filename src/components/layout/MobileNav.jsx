import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Search, MapPin, Wallet, Settings } from 'lucide-react';
import { MessageCircle } from 'lucide-react';
import { auth, supabase } from '@/api/supabaseData';   // supabase must be exported

const baseItems = [
  { label: 'Home', icon: LayoutDashboard, path: '/' },
  { label: 'Search', icon: Search, path: '/search-vehicles' }, // placeholder, will be overridden
  { label: 'Messages', icon: MessageCircle, path: '/messages' },
  { label: 'Track', icon: MapPin, path: '/tracking' },
  { label: 'Wallet', icon: Wallet, path: '/wallet' },
  { label: 'Settings', icon: Settings, path: '/settings' },
];

export default function MobileNav() {
  const location = useLocation();
  const [accountType, setAccountType] = useState('driver');

  // 1. Fetch initial plan
  useEffect(() => {
    auth.me().then(user => {
      setAccountType(user?.subscription_plan || 'driver');
    }).catch(() => {});
  }, []);

  // 2. Listen for auth changes – fires when user metadata is updated
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const plan = session.user.user_metadata?.subscription_plan;
        if (plan) {
          setAccountType(plan);
        }
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Dynamic Search path based on current plan
  const searchPath =
    accountType === 'owner' ? '/find-drivers' :
    accountType === 'both'   ? '/mysearch' :
    '/search-vehicles'; // driver

  // Build navigation items, replacing Search path
  const navItems = baseItems.map(item => {
    if (item.label === 'Search') {
      return { ...item, path: searchPath };
    }
    return item;
  });

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-lg border-t border-border z-50 safe-area-bottom">
      <div className="flex justify-around items-center py-2 px-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.label + item.path}
              to={item.path}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
