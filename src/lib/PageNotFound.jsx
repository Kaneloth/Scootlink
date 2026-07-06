import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';

export default function PageNotFound() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session?.user);
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold text-foreground">404</h1>
        <p className="text-muted-foreground">Page not found</p>
        <Link
          to={isLoggedIn ? '/home' : '/'}
          className="inline-block px-6 py-2 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
        >
          {isLoggedIn ? 'Go to Home' : 'Go to Login'}
        </Link>
      </div>
    </div>
  );
}
