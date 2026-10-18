import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Search, Clock, Briefcase, Settings, LogOut, Users, Plus, Route, Wallet, Rocket, MapPin,
} from 'lucide-react';
import { auth } from '@/api/supabaseData';

// Each role sees the pages it uses, most-used first
const ITEMS = {
  home:      { label: 'Home',            icon: LayoutDashboard, path: '/home'            },
  ride:      { label: 'Request a ride',  icon: MapPin,          path: '/request-gig'     },
  trips:     { label: 'Trips',           icon: Route,           path: '/mysearch'        },
  payments:  { label: 'Payments',        icon: Wallet,          path: '/briefcase'       },
  gigs:      { label: 'Gigs',            icon: Rocket,          path: '/gigs'            },
  earnings:  { label: 'Earnings',        icon: Wallet,          path: '/earnings'        },
  vehicles:  { label: 'Search Vehicles', icon: Search,          path: '/search-vehicles' },
  drivers:   { label: 'Find Drivers',    icon: Users,           path: '/find-drivers'    },
  add:       { label: 'Add Vehicle',     icon: Plus,            path: '/add-vehicle'     },
  activity:  { label: 'Activity',        icon: Clock,           path: '/activity'        },
  briefcase: { label: 'Briefcase',       icon: Briefcase,       path: '/briefcase'       },
  settings:  { label: 'Settings',        icon: Settings,        path: '/settings'        },
};
const NAV_BY_ROLE = {
  customer: ['home', 'ride', 'trips', 'activity', 'payments', 'settings'],
  driver:   ['home', 'gigs', 'earnings', 'vehicles', 'activity', 'briefcase', 'settings'],
  owner:    ['home', 'add', 'drivers', 'gigs', 'activity', 'briefcase', 'settings'],
  both:     ['home', 'gigs', 'earnings', 'vehicles', 'drivers', 'add', 'activity', 'briefcase', 'settings'],
};

export default function Sidebar() {
  const location = useLocation();
  const [user, setUser] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);
  const navItems = (NAV_BY_ROLE[user?.account_type] || NAV_BY_ROLE.both).map((k) => ITEMS[k]);

  return (
    <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-64 bg-card border-r border-border z-40">
      <div className="p-6 border-b border-border">
        <Link to="/home" className="flex items-center gap-3">
          <img src="/favicon.png" alt="Skootlink" className="w-10 h-10 rounded-xl" />
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">Skootlink</h1>
            <p className="text-xs text-muted-foreground">Delivery Rentals</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <item.icon className="w-4.5 h-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        {user && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
              {user.full_name?.[0] || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{user.full_name || 'User'}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => auth.logout()}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all w-full"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
