import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';
import PageHeader from '@/components/layout/PageHeader';
import { supabase } from '@/api/supabaseClient';
import { Loader2 } from 'lucide-react';

// Skeleton card that mimics a vehicle/driver result row
function ResultCardSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-border/50 animate-pulse">
      <div className="flex gap-3">
        <div className="w-20 h-16 rounded-lg bg-muted shrink-0" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-2/3" />
        </div>
        <div className="w-14 h-6 rounded-full bg-muted shrink-0 self-start" />
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-10 rounded-lg bg-muted animate-pulse mb-4" />
      {[1, 2, 3, 4].map((i) => <ResultCardSkeleton key={i} />)}
    </div>
  );
}

export default function SearchPage() {
  const [mounted, setMounted]   = useState(false);
  const [role, setRole]         = useState(null); // null = loading
  const [roleLoading, setRoleLoading] = useState(true);

  // Resolve account role from profiles
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('account_type, role')
            .eq('id', uid)
            .single();

          // Fallback to auth user_metadata — covers users whose profiles row
          // predates the account_type column write
          const { data: { user: authUser } } = await supabase.auth.getUser();
          const metaType = authUser?.user_metadata?.account_type;

          const resolved = profile?.account_type || profile?.role || metaType || 'driver';

          // Backfill profiles row silently if it's missing account_type
          if (!profile?.account_type && metaType) {
            supabase.from('profiles').update({ account_type: metaType }).eq('id', uid);
          }

          setRole(resolved);
        } else {
          setRole('driver');
        }
      } catch {
        setRole('driver');
      } finally {
        setRoleLoading(false);
      }
    })();
  }, []);

  // Wait until the browser has painted skeletons before mounting heavy children
  useEffect(() => {
    if (roleLoading) return;
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [roleLoading]);

  if (roleLoading) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <PageHeader title="Search" backTo="/home" />
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary opacity-60" />
        </div>
      </div>
    );
  }

  const isDriver = role === 'driver';
  const isOwner  = role === 'owner';
  const isBoth   = role === 'both';

  // Driver — only vehicle search, no tabs needed
  if (isDriver) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <PageHeader title="Find Vehicles" backTo="/home" />
        {mounted ? <SearchVehicles /> : <SearchSkeleton />}
      </div>
    );
  }

  // Owner — only driver search, no tabs needed
  if (isOwner) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <PageHeader title="Find Drivers" backTo="/home" />
        {mounted ? <FindDrivers /> : <SearchSkeleton />}
      </div>
    );
  }

  // Both — tabbed interface
  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader title="Search" backTo="/home" />
      <Tabs defaultValue="vehicles">
        <TabsList className="mb-4">
          <TabsTrigger value="vehicles">🔍 Find Vehicles</TabsTrigger>
          <TabsTrigger value="drivers">👤 Find Drivers</TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles">
          {mounted ? <SearchVehicles /> : <SearchSkeleton />}
        </TabsContent>
        <TabsContent value="drivers">
          {mounted ? <FindDrivers /> : <SearchSkeleton />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
