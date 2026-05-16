import React, { useState, useEffect } from 'react';
import { auth } from '@/api/supabaseData';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { SlidersHorizontal, X, Lock, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/layout/PageHeader';
import VehicleCard from '@/components/vehicles/VehicleCard';
import EmptyState from '@/components/common/EmptyState';
import { geocodeLocation } from '@/lib/geocode';

const PAGE_SIZE = 10;

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
      {[1, 2, 3, 4].map((i) => <VehicleCardSkeleton key={i} />)}
    </div>
  );
}

// The vehicles table stores: type (not vehicle_type), price (not price_per_week).
function vehicleFromDb(v) {
  if (!v) return v;
  const mapped = { ...v };
  if ('type'  in mapped) { mapped.vehicle_type   = mapped.type;  delete mapped.type;  }
  if ('price' in mapped) { mapped.price_per_week = mapped.price; delete mapped.price; }
  return mapped;
}

// Uses nearby_vehicles RPC when coords available, falls back to paginated text query
async function fetchVehiclePage({ pageParam = 0, filters }) {
  const { locationCoords, radiusKm } = filters;

  if (locationCoords) {
    // Proximity mode — RPC returns all results within the radius sorted by
    // distance. No text-match merge: mixing in text results would add listings
    // from outside the radius (e.g. a Durban vehicle appearing in a Soweto
    // search). geo_location is backfilled for all existing records.
    if (pageParam > 0) return [];
    const { data, error } = await supabase.rpc('nearby_vehicles', {
      search_lat: locationCoords.latitude,
      search_lng: locationCoords.longitude,
      radius_km:  radiusKm,
    });
    if (error) throw error;
    return (data || [])
      .filter(v => v.status === 'available')
      .filter(v => filters.type === 'all' || v.type === filters.type)
      .filter(v => (v.price ?? 0) <= filters.maxPrice)
      .filter(v => filters.minRating === 0 || (v.rating ?? 0) >= filters.minRating)
      .map(vehicleFromDb);
  }

  // Fallback: paginated text-match query
  let query = supabase
    .from('vehicles')
    .select('*')
    .eq('status', 'available')
    .lte('price', filters.maxPrice)
    .order('created_at', { ascending: false })
    .range(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE - 1);

  if (filters.type !== 'all') query = query.eq('type', filters.type);
  if (filters.location)       query = query.ilike('location', `%${filters.location}%`);
  if (filters.minRating > 0)  query = query.gte('rating', filters.minRating);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(vehicleFromDb);
}

export default function SearchVehicles() {
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState({
    type:           'all',
    maxPrice:       3000,
    location:       '',
    minRating:      0,
    radiusKm:       50,
    locationCoords: null,
  });

  const [localMaxPrice,  setLocalMaxPrice]  = useState(3000);
  const [localRadiusKm,  setLocalRadiusKm]  = useState(50);
  const [geocoding,      setGeocoding]      = useState(false);
  // geocodeTarget only changes on blur/Enter — keeps geocoding off every keystroke
  // while filters.location updates live so text-match responds immediately.
  const [geocodeTarget,  setGeocodeTarget]  = useState('');

  // Geocode only when the user commits a location (blur or Enter).
  // Requires ≥3 characters — shorter strings fall back to text-match silently.
  useEffect(() => {
    if (!geocodeTarget || geocodeTarget.trim().length < 3) {
      setGeocoding(false);
      setFilters(prev => ({ ...prev, locationCoords: null }));
      return;
    }
    let cancelled = false;
    setGeocoding(true);
    geocodeLocation(geocodeTarget).then(coords => {
      if (cancelled) return;
      if (!coords) toast.error('Location not found — showing text-match results instead');
      setFilters(prev => ({ ...prev, locationCoords: coords ?? null }));
    }).finally(() => { if (!cancelled) setGeocoding(false); });
    return () => { cancelled = true; setGeocoding(false); };
  }, [geocodeTarget]);

  const { data: user } = useQuery({
    queryKey:  ['current-user'],
    queryFn:   () => auth.me(),
    staleTime: 5 * 60 * 1000,
    retry:     false,
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
    queryKey:        ['search-vehicles', filters],
    queryFn:         ({ pageParam }) => fetchVehiclePage({ pageParam, filters }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (filters.locationCoords) return undefined; // RPC gives all at once
      return lastPage.length === PAGE_SIZE ? allPages.length : undefined;
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (isError && error) toast.error(`Could not load vehicles: ${error.message}`);
  }, [isError, error]);

  const vehicles  = (data?.pages.flat() ?? []).filter(v => !user || v.owner_id !== user.id);
  const totalLoaded = data?.pages.flat().length ?? 0;

  const commitRadius = (km) =>
    // Bump a copy of locationCoords so the queryKey changes and results refresh
    setFilters(prev => ({
      ...prev,
      radiusKm: km,
      locationCoords: prev.locationCoords ? { ...prev.locationCoords } : null,
    }));

  const clearFilters = () => {
    setLocalMaxPrice(3000);
    setLocalRadiusKm(50);
    setGeocodeTarget('');
    setFilters({ type: 'all', maxPrice: 3000, location: '', minRating: 0, radiusKm: 50, locationCoords: null });
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Find Vehicles"
        subtitle={
          geocoding
            ? 'Locating…'
            : isLoading
              ? 'Loading…'
              : filters.locationCoords
                ? `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} within ${filters.radiusKm} km`
                : totalLoaded > 0
                  ? `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} loaded`
                  : 'No vehicles found'
        }
        backTo="/"
        action={
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Filters
          </Button>
        }
      />

      {showFilters && (
        <Card className="p-5 mb-6 border border-border/50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-sm">Filters</h4>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div>
              <Label className="text-xs">Vehicle Type</Label>
              <Select value={filters.type} onValueChange={(v) => setFilters(prev => ({ ...prev, type: v }))}>
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
              <Label className="text-xs flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Location
                {geocoding && <Loader2 className="w-3 h-3 animate-spin ml-1 text-primary" />}
              </Label>
              <Input
                className="mt-1"
                placeholder="e.g. Randburg — finds nearby too"
                value={filters.location}
                onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value, locationCoords: null }))}
                onBlur={(e) => setGeocodeTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setGeocodeTarget(e.currentTarget.value); e.currentTarget.blur(); } }}
              />
              {filters.locationCoords && (
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                  Searching near: {filters.locationCoords.latitude.toFixed(4)}°,{' '}
                  {filters.locationCoords.longitude.toFixed(4)}°
                  {filters.locationCoords.displayName ? ` — ${filters.locationCoords.displayName}` : ''}
                </p>
              )}
            </div>

            {/* Radius slider — only visible when a location is typed */}
            {filters.location && (
              <div className="sm:col-span-2">
                <Label className="text-xs">
                  Search Radius: <span className="font-semibold text-foreground">{localRadiusKm} km</span>
                  <span className="text-muted-foreground ml-1">— returns all vehicles within this distance</span>
                </Label>
                <div
                  data-no-swipe
                  className="mt-3 touch-none"
                  onPointerDown={() => {
                    const prevent = (e) => e.preventDefault();
                    window.addEventListener('touchmove', prevent, { passive: false });
                    const done = () => {
                      window.removeEventListener('touchmove', prevent);
                      window.removeEventListener('pointerup',     done);
                      window.removeEventListener('pointercancel', done);
                    };
                    window.addEventListener('pointerup',     done, { once: true });
                    window.addEventListener('pointercancel', done, { once: true });
                  }}
                >
                  <Slider
                    value={[localRadiusKm]}
                    min={5}
                    max={200}
                    step={5}
                    onValueChange={([v]) => setLocalRadiusKm(v)}
                    onValueCommit={([v]) => { setLocalRadiusKm(v); commitRadius(v); }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>5 km</span><span>200 km</span>
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">Max Price: R {localMaxPrice}/week</Label>
              <div
                data-no-swipe
                className="mt-3 touch-none"
                onPointerDown={() => {
                  const prevent = (e) => e.preventDefault();
                  window.addEventListener('touchmove', prevent, { passive: false });
                  const done = () => {
                    window.removeEventListener('touchmove', prevent);
                    window.removeEventListener('pointerup',     done);
                    window.removeEventListener('pointercancel', done);
                  };
                  window.addEventListener('pointerup',     done, { once: true });
                  window.addEventListener('pointercancel', done, { once: true });
                }}
              >
                <Slider
                  value={[localMaxPrice]}
                  max={3000}
                  min={100}
                  step={50}
                  onValueChange={([v]) => setLocalMaxPrice(v)}
                  onValueCommit={([v]) => setFilters(prev => ({ ...prev, maxPrice: v }))}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Min Rating</Label>
              <Select value={String(filters.minRating)} onValueChange={(v) => setFilters(prev => ({ ...prev, minRating: Number(v) }))}>
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

          {filters.locationCoords && (
            <p className="text-xs text-primary mt-3 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" />
              Showing results within {filters.radiusKm} km of &ldquo;{filters.location}&rdquo;, sorted by distance
            </p>
          )}
        </Card>
      )}

      {isLoading || geocoding ? (
        <SearchSkeleton />
      ) : vehicles.length > 0 ? (
        <>
          <div className="space-y-3">
            {vehicles.map((v) => {
              const isAdmin     = ['kanelothelejane@gmail.com'].includes(user?.email);
              const canInteract = isAdmin || (user?.subscription_active && user?.verified);
              const lockLabel   = !user?.subscription_active ? 'Subscribe to rent' : 'Verification pending';
              const lockMessage = !user?.subscription_active
                ? 'You need an active subscription to request a rental'
                : "Your account is awaiting verification — you'll be able to rent once approved";

              if (canInteract) {
                return (
                  <Link key={v.id} to={`/rental-request?vehicleId=${v.id}`}>
                    <VehicleCard vehicle={v} />
                  </Link>
                );
              }
              return (
                <div key={v.id} onClick={() => toast.warning(lockMessage)} className="cursor-pointer">
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
              <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="gap-2 min-w-[140px]">
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
          description={
            isError
              ? 'There may be a permissions issue — check Supabase RLS policies on the vehicles table'
              : filters.locationCoords
                ? `No vehicles listed within ${filters.radiusKm} km of "${filters.location}". Try increasing the radius.`
                : 'Try adjusting your filters'
          }
        />
      )}
    </div>
  );
}
