import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Search, MapPin, Wallet, Settings } from 'lucide-react';

const items = [
  { label: 'Home', icon: LayoutDashboard, path: '/' },
  { label: 'Search', icon: Search, path: '/search-vehicles' },
  { label: 'Track', icon: MapPin, path: '/tracking' },
  { label: 'Wallet', icon: Wallet, path: '/wallet' },
  { label: 'Settings', icon: Settings, path: '/settings' },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-lg border-t border-border z-50 safe-area-bottom">
      <div className="flex justify-around items-center py-2 px-2">
        {items.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
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