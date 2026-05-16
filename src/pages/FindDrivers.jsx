import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, auth, Vehicle, fetchProfilesByIds } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { MapPin, Clock, MessageCircle, ShieldCheck, SlidersHorizontal, X, User as UserIcon, FileText, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import StarRating from '@/components/reviews/StarRating';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import { geocodeLocation } from '@/lib/geocode';

export default function FindDrivers() {
  const navigate = useNavigate();
  const [driverReviews,    setDriverReviews]    = useState([]);
  const [loadingReviews,   setLoadingReviews]   = useState(false);
  const [showFilters,      setShowFilters]      = useState(false);
  const [filters,          setFilters]          = useState({ location: '', minExperience: 0, minRating: 0, radius: 50 });
  const [currentUser,      setCurrentUser]      = useState(null);
  const [selectedDriver,   setSelectedDriver]   = useState(null);
  const [avatarMap,        setAvatarMap]        = useState({});

  // ── Proximity state ──────────────────────────────────────────────────────
  const [locationInput,    setLocationInput]    = useState('');   // what the user types
  const [locationCoords,   setLocationCoords]   = useState(null); // geocoded coords
  const [geocoding,        setGeocoding]        = useState(false);
  const [rpcDrivers,       setRpcDrivers]       = useState(null); // null = use User.list(); array = RPC results

  // Owner‑initiated contract state (unchanged)
  const [showContractForm, setShowContractForm] = useState(false);
  const [ownerVehicles,    setOwnerVehicles]    = useState([]);
  const [contractForm,     setContractForm]     = useState({ /* … */ });
  const [sendingContract, setSendingContract] = useState(false);

  // ── Load current user & their vehicles ───────────────────────────────────
  useEffect(() => {
    auth.me().then(u => {
      setCurrentUser(u);
      if (u?.id) Vehicle.filter({ owner_id: u.id }).then(setOwnerVehicles).catch(() => {});
    }).catch(() => {});
  }, []);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn:  () => User.list(),
  });

  useEffect(() => {
    if (!users.length) return;
    fetchProfilesByIds(users.map(u => u.id))
      .then(enriched => {
        const map = {};
        enriched.forEach(p => { map[p.id] = p; });
        setAvatarMap(map);
      })
      .catch(() => {});
  }, [users]);

  // ── Commit location only on Enter / blur ─────────────────────────────────
  const commitLocation = () => {
    const trimmed = locationInput.trim();
    setFilters(prev => ({ ...prev, location: trimmed }));
    // Reset coords – the geocode effect will fire because filters.location changed
    setLocationCoords(null);
  };

  // ── Geocode effect – runs only when filters.location changes ─────────────
  useEffect(() => {
    if (!filters.location || filters.location.length < 3) {
      setGeocoding(false);
      setLocationCoords(null);
      setRpcDrivers(null);
      return;
    }
    let cancelled = false;
    setGeocoding(true);
    geocodeLocation(filters.location).then(coords => {
      if (cancelled) return;
      if (!coords) {
        toast.error('Location not found — showing text‑match results instead');
        setLocationCoords(null);
      } else {
        setLocationCoords(coords);
      }
    }).finally(() => { if (!cancelled) setGeocoding(false); });

    return () => { cancelled = true; setGeocoding(false); };
  }, [filters.location]);

  // ── RPC effect – refires when coords or radius change ────────────────────
  useEffect(() => {
    if (!locationCoords) {
      setRpcDrivers(null);
      return;
    }
    let cancelled = false;
    setGeocoding(true);
    supabase.rpc('nearby_drivers', {
      search_lat: locationCoords.latitude,
      search_lng: locationCoords.longitude,
      radius_km:  filters.radius,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('nearby_drivers RPC error:', error);
        toast.error('Proximity search failed — showing text‑match results');
        setRpcDrivers(null);
      } else {
        setRpcDrivers(data || []);
      }
    }).finally(() => { if (!cancelled) setGeocoding(false); });

    return () => { cancelled = true; setGeocoding(false); };
  }, [locationCoords, filters.radius]);

  // ── Derived driver list ──────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const drivers = useMemo(() => {
    let source;
    if (rpcDrivers !== null && locationCoords) {
      const rpcIds = new Set(rpcDrivers.map(d => d.id));
      const textExtras = users.filter(u =>
        (u.account_type === 'driver' || u.account_type === 'both') &&
        (u.location || '').toLowerCase().includes(filters.location.toLowerCase()) &&
        !rpcIds.has(u.id),
      );
      source = [...rpcDrivers, ...textExtras];
    } else {
      source = users;
    }

    return source.filter(u => {
      if (u.account_type !== 'driver' && u.account_type !== 'both') return false;
      if (!locationCoords && filters.location && !(u.location || '').toLowerCase().includes(filters.location.toLowerCase())) return false;
      if (filters.minExperience > 0 && u.license_year && (currentYear - u.license_year) < filters.minExperience) return false;
      if (filters.minRating > 0 && (u.rating || 0) < filters.minRating) return false;
      return true;
    });
  }, [rpcDrivers, users, filters, locationCoords, currentYear]);

  // ── Review & contract helpers (unchanged) ─────────────────────────────────
  const fetchDriverReviews = async (driverId) => { /* … same as before … */ };
  const openDriverDetail = (driver) => { /* … same as before … */ };
  const handleSendContract = async () => { /* … same as before … */ };

  // ── Clear filters ────────────────────────────────────────────────────────
  const clearFilters = () => {
    setLocationInput('');
    setFilters({ location: '', minExperience: 0, minRating: 0, radius: 50 });
    setLocationCoords(null);
    setRpcDrivers(null);
  };

  const isOwner = currentUser?.subscription_plan === 'owner' || currentUser?.subscription_plan === 'both' || !currentUser?.subscription_active;
  const isSearching = isLoading || geocoding;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Find Drivers"
        subtitle={
          geocoding
            ? 'Locating…'
            : locationCoords
              ? `${drivers.length} driver${drivers.length !== 1 ? 's' : ''} within ${filters.radius} km`
              : `${drivers.length} driver${drivers.length !== 1 ? 's' : ''} found`
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
              <Label className="text-xs flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Location
                {geocoding && <Loader2 className="w-3 h-3 animate-spin ml-1 text-primary" />}
              </Label>
              <Input
                className="mt-1"
                placeholder="e.g. Soweto — finds nearby drivers"
                value={locationInput}
                onChange={e => setLocationInput(e.target.value)}
                onBlur={commitLocation}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </div>
            <div>
              <Label className="text-xs">Min Experience (years)</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                value={filters.minExperience || ''}
                onChange={e => setFilters(p => ({ ...p, minExperience: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <Label className="text-xs">Min Rating</Label>
              <Select value={String(filters.minRating)} onValueChange={v => setFilters(p => ({ ...p, minRating: Number(v) }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any</SelectItem>
                  <SelectItem value="4">4+ Stars</SelectItem>
                  <SelectItem value="5">5 Stars Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">
                Search Radius: <span className="font-semibold text-foreground">{filters.radius} km</span>
              </Label>
              <Slider
                className="mt-3"
                min={5}
                max={200}
                step={5}
                value={[filters.radius]}
                onValueChange={([v]) => setFilters(p => ({ ...p, radius: v }))}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>5 km</span><span>200 km</span>
              </div>
            </div>
          </div>

          {locationCoords && (
            <p className="text-xs text-primary mt-3 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" />
              Showing drivers within {filters.radius} km of &ldquo;{filters.location}&rdquo;, sorted by distance
            </p>
          )}
        </Card>
      )}

      {/* ── Driver list ──────────────────────────────────────────────────── */}
      {isSearching ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : drivers.length > 0 ? (
        <div className="space-y-3">
          {drivers.map(d => {
            const exp = d.license_year ? currentYear - d.license_year : 0;
            return (
              <Card
                key={d.id}
                className="p-4 border border-border/50 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => openDriverDetail(d)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0 overflow-hidden">
                      {/* avatar display (unchanged) */}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-foreground text-sm truncate">{d.full_name || 'Driver'}</h4>
                        {d.verified && <ShieldCheck className="w-4 h-4 text-primary shrink-0" />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                        {d.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{d.location}</span>}
                        {exp > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{exp}y exp</span>}
                        {d.rating > 0 && <StarRating value={Math.round(d.rating)} size="sm" showValue />}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 text-xs px-2.5 py-1.5"
                    onClick={(e) => { e.stopPropagation(); openDriverDetail(d); }}>
                    <UserIcon className="w-3 h-3 mr-1" /> Details
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="👤"
          title="No drivers found"
          description={
            locationCoords
              ? `No drivers found within ${filters.radius} km of "${filters.location}". Try increasing the radius.`
              : 'Try adjusting your search filters'
          }
        />
      )}

      {/* ── Driver Detail Modal (unchanged) ────────────────────────────────── */}
      {/* … rest of the component, including the contract form, stays exactly as before … */}
    </div>
  );
}