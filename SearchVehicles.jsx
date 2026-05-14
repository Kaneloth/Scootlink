import React, { useState } from 'react';
import { auth, supabase } from '@/api/supabaseData';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { SlidersHorizontal, X, Lock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/layout/PageHeader';
import VehicleCard from '@/components/vehicles/VehicleCard';
import EmptyState from '@/components/common/EmptyState';

const PAGE_SIZE = 10;

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function VehicleCardSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-border/50 animate-pulse">
      <div className="flex gap-3">
        <div className="w-24 h-20 rounded-lg bg-muted shrink-0" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3.5 bg-muted rounded w-2/5" />
          <div className="h-3 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-1/4" />
        </div>
        <div className="w-16 h-7 rounded-full bg-muted shrink-0 self-start" />
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <VehicleCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ─── Column name mapping ───────────────────────────────────────────────────────
// The Supabase vehicles table stores: type (not vehicle_type), price (not price_per_week).
// vehicleFromDb converts DB rows back to the app's field names after fetching.

function vehicleFromDb(v) {
  if (!v) return v;
  const mapped = { ...v };
  if ('type' in mapped) { mapped.vehicle_type = mapped.type; delete mapped.type; }
  if ('price' in mapped) { mapped.price_per_week = mapped.price; delete mapped.price; }
  return mapped;
}

// ─── Server-side vehicle fetcher ──────────────────────────────────────────────
// Uses the actual DB column names (type, price) for filtering.

async function fetchVehiclePage({ pageParam = 0, filters }) {
  let query = supabase
    .from('vehicles')
    .select('*')
    .eq('status', 'available')
    .lte('price', filters.maxPrice)          // DB column is "price"
    .order('created_at', { ascending: false })
    .range(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE - 1);

  if (filters.type !== 'all') {
    query = query.eq('type', filters.type);  // DB column is "type"
  }
  if (filters.location) {
    query = query.ilike('location', `%${filters.location}%`);
  }
  if (filters.minRating > 0) {
    query = query.gte('rating', filters.minRating);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Convert DB column names to app field names before returning
  return (data ?? []).map(vehicleFromDb);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SearchVehicles() {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    type: 'all',
    maxPrice: 3000,   // match slider max so no vehicles are hidden on first load
    location: '',
    minRating: 0,
  });

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => auth.me(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ['search-vehicles', filters],
    queryFn: ({ pageParam }) => fetchVehiclePage({ pageParam, filters }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    staleTime: 60 * 1000,
  });

  // Surface DB errors (e.g. RLS blocking reads) as a visible toast
  React.useEffect(() => {
    if (isError && error) {
      toast.error(`Could not load vehicles: ${error.message}`);
    }
  }, [isError, error]);

  // Flatten pages, then filter out the current user's own listings by owner_id
  const vehicles = (data?.pages.flat() ?? []).filter(
    (v) => !user || v.owner_id !== user.id
  );

  const totalLoaded = data?.pages.flat().length ?? 0;

  if (isLoading) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <PageHeader
          title="Find Vehicles"
          subtitle="Loading…"
          backTo="/"
          action={
            <Button variant="outline" size="sm" disabled className="gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              Filters
            </Button>
          }
        />
        <SearchSkeleton />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Find Vehicles"
        subtitle={
          totalLoaded > 0
            ? `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} loaded`
            : 'No vehicles found'
        }
        backTo="/"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </Button>
        }
      />

      {showFilters && (
        <Card className="p-5 mb-6 border border-border/50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-sm">Filters</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters({ type: 'all', maxPrice: 2000, location: '', minRating: 0 })}
            >
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Vehicle Type</Label>
              <Select
                value={filters.type}
                onValueChange={(v) => setFilters((prev) => ({ ...prev, type: v }))}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="scooter">Scooter</SelectItem>
                  <SelectItem value="motorcycle">Motorcycle</SelectItem>
                  <SelectItem value="car">Car</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Johannesburg"
                value={filters.location}
                onChange={(e) => setFilters((prev) => ({ ...prev, location: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Max Price: R {filters.maxPrice}/week</Label>
              <Slider
                className="mt-3"
                value={[filters.maxPrice]}
                max={3000}
                min={100}
                step={50}
                onValueChange={([v]) => setFilters((prev) => ({ ...prev, maxPrice: v }))}
              />
            </div>
            <div>
              <Label className="text-xs">Min Rating</Label>
              <Select
                value={String(filters.minRating)}
                onValueChange={(v) => setFilters((prev) => ({ ...prev, minRating: Number(v) }))}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any</SelectItem>
                  <SelectItem value="3">3+ Stars</SelectItem>
                  <SelectItem value="4">4+ Stars</SelectItem>
                  <SelectItem value="5">5 Stars Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      {vehicles.length > 0 ? (
        <>
          <div className="space-y-3">
            {vehicles.map((v) => {
              const isAdmin = ['kanelothelejane@gmail.com'].includes(user?.email);
              const isSubscribed = user?.subscription_active;
              const isVerified = user?.verified;
              const canInteract = isAdmin || (isSubscribed && isVerified);

              const lockLabel = !isSubscribed
                ? 'Subscribe to rent'
                : 'Verification pending';
              const lockMessage = !isSubscribed
                ? 'You need an active subscription to request a rental'
                : 'Your account is awaiting verification — you\'ll be able to rent once approved';

              if (canInteract) {
                return (
                  <Link key={v.id} to={`/rental-request?vehicleId=${v.id}`}>
                    <VehicleCard vehicle={v} />
                  </Link>
                );
              }
              return (
                <div
                  key={v.id}
                  onClick={() => toast.warning(lockMessage)}
                  className="cursor-pointer"
                >
                  <div className="relative">
                    <VehicleCard vehicle={v} />
                    <div className="absolute bottom-0 left-0 right-0 bg-amber-500/90 text-white text-[11px] font-medium px-3 py-1.5 rounded-b-xl flex items-center justify-center gap-1.5">
                      <Lock className="w-3 h-3 shrink-0" /> {lockLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="gap-2 min-w-[140px]"
              >
                {isFetchingNextPage
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                  : 'Load more'}
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={isError ? '⚠️' : '🔍'}
          title={isError ? 'Could not load vehicles' : 'No vehicles found'}
          description={isError ? 'There may be a permissions issue — check Supabase RLS policies on the vehicles table' : 'Try adjusting your filters'}
        />
      )}
    </div>
  );
}
