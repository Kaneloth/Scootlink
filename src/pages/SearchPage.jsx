import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SearchVehicles from '@/pages/SearchVehicles';
import FindDrivers from '@/pages/FindDrivers';

// Skeleton card that mimics a vehicle/driver result row
function ResultCardSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-border/50 animate-pulse">
      <div className="flex gap-3">
        {/* Thumbnail placeholder */}
        <div className="w-20 h-16 rounded-lg bg-muted shrink-0" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-2/3" />
        </div>
        {/* Badge / price placeholder */}
        <div className="w-14 h-6 rounded-full bg-muted shrink-0 self-start" />
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-3">
      {/* Search bar placeholder */}
      <div className="h-10 rounded-lg bg-muted animate-pulse mb-4" />
      {/* Result cards */}
      {[1, 2, 3, 4].map((i) => (
        <ResultCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default function SearchPage() {
  // `mounted` flips to true after the first render cycle.
  // This gives child components one render tick to start their data fetches
  // while skeletons are displayed, so the user never sees a blank page.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Use requestAnimationFrame to wait until the browser has painted the
    // skeleton before handing off to the real components.
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Search</h1>
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
