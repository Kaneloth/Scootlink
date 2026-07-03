import React, { useState, useEffect, useRef } from 'react';
import { auth } from '@/api/supabaseData';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { SlidersHorizontal, X, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/layout/PageHeader';
import VehicleCard from '@/components/vehicles/VehicleCard';
import EmptyState from '@/components/common/EmptyState';
import ProvinceBrowser, { SEARCH_RADIUS_KM } from '@/components/search/ProvinceBrowser';
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
      .filter(v => !v.listing_state || v.listing_state === 'active')
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
    .or('listing_state.is.null,listing_state.eq.active')
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
  const navigate = useNavigate();
  const autoLocationRef = useRef(null);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState({
    type:           'all',
    maxPrice:       3000,
    location:       '',
    minRating:      0,
    radiusKm:       SEARCH_RADIUS_KM,
    locationCoords: null,
  });

  const [localMaxPrice,  setLocalMaxPrice]  = useState(3000);
  const [localRadiusKm,  setLocalRadiusKm]  = useState(SEARCH_RADIUS_KM);
  const [geocoding,      setGeocoding]      = useState(false);
  const [geocodeTarget,  setGeocodeTarget]  = useState('');
  const [selectedProvince, setSelectedProvince] = useState(null); // null = show province browser
  const [hasSearched, setHasSearched] = useState(false);

  const handleSelectProvince = (province) => {
    setSelectedProvince(province);
    setHasSearched(true);
    const label = province.locationLabel || (province.isUserLocation ? 'Your location' : province.city);
    setFilters(prev => ({
      ...prev,
      location: label,
      locationCoords: {
        latitude: province.lat,
        longitude: province.lng,
        displayName: province.locationLabel
          ? `${province.locationLabel}, ${province.name}`
          : province.isUserLocation ? 'Your location' : `${province.city}, ${province.name}`,
      },
      radiusKm: SEARCH_RADIUS_KM,
    }));
  };

  const backToProvinces = () => {
    setSelectedProvince(null);
    setHasSearched(false);
    setShowFilters(false);
    setFilters({
      type: 'all', maxPrice: 3000, location: '', minRating: 0,
      radiusKm: SEARCH_RADIUS_KM, locationCoords: null,
    });
  };

  // Geocode only when the user commits a location (blur or Enter).
  // Requires ≥3 characters — shorter strings fall back to text-match silently.
  useEffect(() => {
    if (!geocodeTarget || geocodeTarget.trim().length < 3) {
      setGeocoding(false);
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

  // Fetch blacklisted owner IDs so their vehicles are hidden from search
  const { data: blacklistedOwnerIds = [] } = useQuery({
    queryKey:  ['blacklisted-users'],
    queryFn:   async () => {
      const { data } = await supabase.from('profiles').select('id').eq('blacklisted', true);
      return (data || []).map(p => p.id);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Admin's own listings must never appear in search results
  const ADMIN_EMAILS_FILTER = ['kaneloth@skootlink.co.za'];
  const { data: adminOwnerIds = [] } = useQuery({
    queryKey:  ['admin-owner-ids'],
    queryFn:   async () => {
      const { data } = await supabase.from('profiles').select('id').in('email', ADMIN_EMAILS_FILTER);
      return (data || []).map(p => p.id);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Verification status — keyed by owner id for fast lookup
  const [verifiedOwnerIds,      setVerifiedOwnerIds]      = useState(new Set());
  const [fullyVerifiedOwnerIds, setFullyVerifiedOwnerIds] = useState(new Set());
  const [verifiedOwnerFilter,   setVerifiedOwnerFilter]   = useState('all'); // 'all' | 'id_verified' | 'fully_verified'

  useEffect(() => {
    supabase.from('profiles').select('id, id_verified, licence_verified').eq('id_verified', true)
      .then(({ data }) => {
        if (!data) return;
        setVerifiedOwnerIds(new Set(data.map(p => p.id)));
        setFullyVerifiedOwnerIds(new Set(data.filter(p => p.licence_verified).map(p => p.id)));
      });
  }, []);

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
    enabled:          hasSearched,
    getNextPageParam: (lastPage, allPages) => {
      if (filters.locationCoords) return undefined; // RPC gives all at once
      return lastPage.length === PAGE_SIZE ? allPages.length : undefined;
    },
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (isError && error) toast.error(`Could not load vehicles: ${error.message}`);
  }, [isError, error]);

  // Defensively flatten pages — stale/transitioning query state can leave
  // undefined entries in pages[], which crash .filter() on the next render.
  const allVehicles = (data?.pages ?? [])
    .flatMap(page => (Array.isArray(page) ? page : []))
    .filter(v => v != null);
  const vehicles    = allVehicles.filter(v => {
    if (!(!user || v.owner_id !== user.id)) return false;
    if (blacklistedOwnerIds.includes(v.owner_id)) return false;
    if (adminOwnerIds.includes(v.owner_id)) return false;
    if (verifiedOwnerFilter === 'id_verified'    && !verifiedOwnerIds.has(v.owner_id))      return false;
    if (verifiedOwnerFilter === 'fully_verified' && !fullyVerifiedOwnerIds.has(v.owner_id)) return false;
    return true;
  });
  const totalLoaded = allVehicles.length;

  const commitRadius = (km) =>
    // Bump a copy of locationCoords so the queryKey changes and results refresh
    setFilters(prev => ({
      ...prev,
      radiusKm: km,
      locationCoords: prev.locationCoords ? { ...prev.locationCoords } : null,
    }));

  const clearFilters = () => {
    setLocalMaxPrice(3000);
    setLocalRadiusKm(SEARCH_RADIUS_KM);
    setGeocodeTarget('');
    setVerifiedOwnerFilter('all');
    setFilters({
      type:           'all',
      maxPrice:       3000,
      location:       selectedProvince?.city || '',
      minRating:      0,
      radiusKm:       SEARCH_RADIUS_KM,
      locationCoords: selectedProvince
        ? { latitude: selectedProvince.lat, longitude: selectedProvince.lng, displayName: `${selectedProvince.city}, ${selectedProvince.name}` }
        : null,
    });
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Find Vehicles"
        backTo="/home"
        subtitle={
          !hasSearched
            ? 'Choose a province to see nearby vehicles'
            : geocoding
              ? 'Locating…'
              : isLoading
                ? 'Loading…'
                : `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} within ${filters.radiusKm} km of ${selectedProvince?.locationLabel || (selectedProvince?.isUserLocation ? 'your location' : (selectedProvince?.city || filters.location))}`
        }
        action={
          hasSearched && (
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-2">
              <SlidersHorizontal className="w-4 h-4" /> Filters
            </Button>
          )
        }
      />

      {!hasSearched ? (
        <ProvinceBrowser mode="vehicles" onSelectProvince={handleSelectProvince} />
      ) : (
        <>
      <div className="mb-3">
        <button onClick={backToProvinces} className="text-xs text-primary hover:underline">
          ← Browse a different province
        </button>
      </div>
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
              <Label className="text-xs">Owner Verification</Label>
              <Select value={verifiedOwnerFilter} onValueChange={setVerifiedOwnerFilter}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  <SelectItem value="id_verified">✅ ID Verified</SelectItem>
                  <SelectItem value="fully_verified">🛡️ Fully Verified</SelectItem>
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
            {(() => {
              return vehicles.map((v) => {
              if (!v?.id) return null;
              return (
                <VehicleCard key={v.id} vehicle={v} onClick={() => navigate(`/rental-request?vehicleId=${v.id}`)} />
              );
            });
            })()}
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
      </>
      )}
    </div>
  );
}
