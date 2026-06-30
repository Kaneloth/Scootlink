import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { User, auth, Vehicle, fetchProfilesByIds } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { MapPin, Clock, MessageCircle, ShieldCheck, SlidersHorizontal, X, User as UserIcon, FileText, ChevronDown, ChevronUp, Loader2, Check } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import StarRating from '@/components/reviews/StarRating';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ProvinceBrowser, { SEARCH_RADIUS_KM } from '@/components/search/ProvinceBrowser';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import { geocodeLocation } from '@/lib/geocode';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { notify } from '@/lib/notify';

export default function FindDrivers() {
  const navigate = useNavigate();
  const [driverReviews,    setDriverReviews]    = useState([]);
  const [loadingReviews,   setLoadingReviews]   = useState(false);
  const [showFilters,      setShowFilters]      = useState(false);
  const [filters,          setFilters]          = useState({ location: '', minExperience: 0, minRating: 0, radius: SEARCH_RADIUS_KM });
  const [geocodeTarget,    setGeocodeTarget]    = useState('');
  const [currentUser,      setCurrentUser]      = useState(null);
  const [selectedProvince, setSelectedProvince] = useState(null); // null = show province browser
  const [hasSearched,      setHasSearchedState] = useState(false);

  const [selectedDriver,   setSelectedDriver]   = useState(null);
  const [avatarMap,        setAvatarMap]        = useState({});
  const [lightboxSrc,      setLightboxSrc]      = useState(null);

  // Proximity state
  const autoLocationRef = useRef(null);
  const [locationCoords,   setLocationCoords]   = useState(null);
  const [geocoding,        setGeocoding]        = useState(false);
  const [rpcDrivers,       setRpcDrivers]       = useState(null); // null = use User.list(); array = RPC results

  // Owner-initiated contract state
  const [showContractForm, setShowContractForm] = useState(false);
  const [ownerVehicles,    setOwnerVehicles]    = useState([]);
  const [contractForm,     setContractForm]     = useState({
    vehicle_id:     '',
    start_date:     new Date().toISOString().split('T')[0],
    end_date:       new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    price_per_week: '',
    deposit:        '',
    message:        '',
  });
  const [sendingContract, setSendingContract] = useState(false);
  const [showContractPreview, setShowContractPreview] = useState(false);
  const [contractPreviewText, setContractPreviewText] = useState('');

  useEffect(() => {
    auth.me().then(u => {
      setCurrentUser(u);
      if (u?.id) Vehicle.filter({ owner_id: u.id }).then(setOwnerVehicles).catch(() => {});
    }).catch(() => {});
  }, []);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn:  () => User.list(),
    enabled:  hasSearched,
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

  const handleSelectProvince = (province) => {
    setSelectedProvince(province);
    setHasSearchedState(true);
    const coords = {
      latitude: province.lat,
      longitude: province.lng,
      displayName: province.isUserLocation ? 'Your location' : `${province.city}, ${province.name}`,
    };
    autoLocationRef.current = coords;
    setLocationCoords(coords);
    setFilters(prev => ({ ...prev, location: province.isUserLocation ? 'Your location' : province.city, radius: SEARCH_RADIUS_KM }));
  };

  const backToProvinces = () => {
    setSelectedProvince(null);
    setHasSearchedState(false);
    setShowFilters(false);
    setLocationCoords(null);
    setRpcDrivers(null);
    setFilters({ location: '', minExperience: 0, minRating: 0, radius: SEARCH_RADIUS_KM });
  };

  // Effect 1: Geocode only when the user commits a location (blur or Enter).
  // Requires ≥3 characters — shorter strings fall back to text-match silently.
  useEffect(() => {
    if (!geocodeTarget || geocodeTarget.trim().length < 3) {
      setGeocoding(false);
      // Restore the selected province's coords when the location input is cleared.
      setLocationCoords(autoLocationRef.current);
      if (autoLocationRef.current && selectedProvince) setFilters(prev => ({ ...prev, location: selectedProvince.city }));
      setRpcDrivers(null);
      return;
    }
    let cancelled = false;
    setGeocoding(true);
    setRpcDrivers(null);

    geocodeLocation(geocodeTarget).then(coords => {
      if (cancelled) return;
      if (!coords) {
        toast.error('Location not found — showing text-match results instead');
        setLocationCoords(null);
      } else {
        setLocationCoords(coords);
      }
    }).finally(() => { if (!cancelled) setGeocoding(false); });

    return () => { cancelled = true; setGeocoding(false); };
  }, [geocodeTarget]);

  // Effect 2: Call the RPC whenever we have valid coords OR when the radius
  // slider changes. Keeping this separate means moving the slider never
  // re-geocodes and never fires the "location not found" toast.
  useEffect(() => {
    if (!locationCoords) {
      setRpcDrivers(null);
      return;
    }
    let cancelled = false;
    setGeocoding(true);

    const rpcParams = {
      search_lat: locationCoords.latitude,
      search_lng: locationCoords.longitude,
      radius_km:  filters.radius,
    };
    console.log('[FindDrivers] Calling nearby_drivers RPC with:', rpcParams);

    supabase.rpc('nearby_drivers', rpcParams).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('[FindDrivers] nearby_drivers RPC error:', error);
        toast.error('Proximity search failed — showing text-match results');
        setRpcDrivers(null);
      } else {
        console.log('[FindDrivers] RPC returned', (data || []).length, 'drivers:', data);
        setRpcDrivers(data || []);
      }
    }).finally(() => { if (!cancelled) setGeocoding(false); });

    return () => { cancelled = true; setGeocoding(false); };
  }, [locationCoords, filters.radius]);

  const currentYear = new Date().getFullYear();

  const drivers = useMemo(() => {
    let source;

    if (rpcDrivers !== null && locationCoords) {
      // Proximity mode — use only the RPC results (already radius-filtered).
      // No text-match merge: adding text-match results bypasses the radius and
      // causes distant drivers (e.g. Durban) to appear in a Soweto search.
      // geo_location is backfilled for all existing profiles.
      source = rpcDrivers;
    } else {
      source = users;
    }

    const ADMIN_EMAILS_FILTER = ['kaneloth@skootlink.co.za'];
    return source.filter(u => {
      if (currentUser?.id && u.id === currentUser.id) return false; // never show yourself
      if (u.blacklisted) return false; // blacklisted users are hidden
      // Admin account always appears in search results regardless of account_type
      const isAdminUser = ADMIN_EMAILS_FILTER.includes(u.email);
      if (!isAdminUser && u.account_type !== 'driver' && u.account_type !== 'both') return false;
      if (!locationCoords && filters.location && !(u.location || '').toLowerCase().includes(filters.location.toLowerCase())) return false;
      if (!isAdminUser) {
        if (filters.minExperience > 0 && u.license_year && (currentYear - u.license_year) < filters.minExperience) return false;
        if (filters.minRating > 0 && (u.rating || 0) < filters.minRating) return false;
      }
      return true;
    });
  }, [rpcDrivers, users, filters, locationCoords, currentYear, currentUser]);

  const fetchDriverReviews = async (driverId) => {
    setLoadingReviews(true);
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, comment, created_at, reviewer_id')
        .eq('target_id', driverId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      setDriverReviews(data || []);
    } catch (err) {
      console.error('Failed to load reviews:', err);
    } finally {
      setLoadingReviews(false);
    }
  };

  const openDriverDetail = (driver) => {
    setSelectedDriver(driver);
    setShowContractForm(false);
    setContractForm(f => ({
      ...f,
      vehicle_id: '', price_per_week: '', deposit: '', message: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    }));
    fetchDriverReviews(driver.id);
  };

  const selectedVehicle = useMemo(
    () => ownerVehicles.find(v => String(v.id) === String(contractForm.vehicle_id)) || null,
    [ownerVehicles, contractForm.vehicle_id],
  );

  const estimate = useMemo(() => {
    if (!selectedVehicle || !contractForm.start_date || !contractForm.end_date) return null;
    const days  = Math.max(1, Math.ceil((new Date(contractForm.end_date) - new Date(contractForm.start_date)) / (1000 * 60 * 60 * 24)));
    const weeks = Math.ceil(days / 7);
    const rate  = parseFloat(contractForm.price_per_week) || selectedVehicle.price_per_week || 0;
    return { weeks, total: weeks * rate };
  }, [selectedVehicle, contractForm]);

  const ADMIN_EMAILS = ['kaneloth@skootlink.co.za'];
  const isCurrentUserAdmin = ADMIN_EMAILS.includes(currentUser?.email);
  const canSendContract = true; // no subscription required — any owner can initiate a rental

  const generateContractText = (vehicle, driver, owner, form) => {
    const startDate = form.start_date ? new Date(form.start_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '___________';
    const endDate   = form.end_date   ? new Date(form.end_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '___________';
    const today     = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
    const weeks     = (form.start_date && form.end_date)
      ? Math.max(1, Math.ceil((new Date(form.end_date) - new Date(form.start_date)) / (1000 * 60 * 60 * 24 * 7)))
      : 0;
    const rate      = parseFloat(form.price_per_week) || vehicle?.price_per_week || 0;
    const deposit   = parseFloat(form.deposit) || vehicle?.deposit || 0;
    const total     = weeks * rate;

    return `VEHICLE RENTAL AGREEMENT
${'='.repeat(50)}

This Rental Agreement ("Agreement") is entered into on ${today} between:

OWNER:  ${owner?.full_name || '___________'}
        ID/Passport: ${owner?.id_number || owner?.id_document_number || '___________'}
        Phone: ${owner?.phone || '___________'}

DRIVER: ${driver?.full_name || '___________'}
        ID/Passport: ${driver?.id_number || driver?.id_document_number || '___________'}
        Licence No:  ${driver?.license_number || '___________'}
        Phone: ${driver?.phone || '___________'}

${'─'.repeat(50)}
1. VEHICLE DETAILS
${'─'.repeat(50)}

Make & Model:  ${vehicle ? `${vehicle.make} ${vehicle.model}` : '___________'}
Year:          ${vehicle?.year || '___________'}
Plate Number:  ${vehicle?.plate || '___________'}
Vehicle Type:  ${vehicle?.type || vehicle?.vehicle_type || '___________'}
Colour:        ${vehicle?.colour || vehicle?.color || '___________'}

${'─'.repeat(50)}
2. RENTAL PERIOD
${'─'.repeat(50)}

Start Date:  ${startDate}
End Date:    ${endDate}
Duration:    ${weeks} week${weeks !== 1 ? 's' : ''}

${'─'.repeat(50)}
3. FINANCIAL TERMS
${'─'.repeat(50)}

Weekly Rate:   R ${rate.toFixed(2)}
Total Amount:  R ${total.toFixed(2)} (${weeks} week${weeks !== 1 ? 's' : ''})
Deposit:       R ${deposit.toFixed(2)}
Payment Due:   Weekly in advance

${form.message ? `Notes: ${form.message}\n` : ''}
${'─'.repeat(50)}
4. DRIVER RESPONSIBILITIES
${'─'.repeat(50)}

The Driver agrees to:
• Use the vehicle solely for lawful delivery and transport purposes
• Maintain the vehicle in clean and roadworthy condition
• Report any accident, damage, or mechanical fault to the Owner within 24 hours
• Not sublet or loan the vehicle to any third party
• Return the vehicle on the agreed end date in the same condition as received
• Cover all traffic fines, fuel, and day-to-day running costs

${'─'.repeat(50)}
5. OWNER RESPONSIBILITIES
${'─'.repeat(50)}

The Owner agrees to:
• Provide the vehicle in a roadworthy and insured condition
• Ensure the vehicle has a valid licence disc and roadworthy certificate
• Not recall the vehicle before the end date without 7 days' written notice, except in the case of breach

${'─'.repeat(50)}
6. DEPOSIT & REFUND
${'─'.repeat(50)}

The deposit of R ${deposit.toFixed(2)} is held as security against damages, unpaid rent, or fines.
Any damages, fines, or additional charges will be deducted from the deposit.
The remaining deposit balance will be refunded within 7 days of the vehicle's return, subject to inspection.

${'─'.repeat(50)}
7. TERMINATION
${'─'.repeat(50)}

Either party may terminate this Agreement with 7 days' written notice.
Immediate termination is permitted in the event of:
• Non-payment of weekly rental
• Reckless or unlawful use of the vehicle
• Material breach of any term of this Agreement

${'─'.repeat(50)}
8. GOVERNING LAW
${'─'.repeat(50)}

This Agreement is governed by the laws of the Republic of South Africa.
Any disputes shall be resolved through mediation before escalating to legal proceedings.

${'─'.repeat(50)}
9. SIGNATURES
${'─'.repeat(50)}

By confirming this Agreement on the Skootlink platform, both parties agree to be legally bound by all terms above.

Owner:   ${owner?.full_name || '___________'}    Date: ${today}
Driver:  ${driver?.full_name || '___________'}   Date: ___________

${'='.repeat(50)}
Generated by Skootlink (Pty) Ltd · www.skootlink.co.za
`;
  };

  const handlePreviewContract = () => {
    if (!contractForm.vehicle_id)                            { toast.error('Please select a vehicle'); return; }
    if (!contractForm.start_date || !contractForm.end_date)  { toast.error('Please set the rental dates'); return; }
    if (!contractForm.price_per_week)                        { toast.error('Please enter the weekly rate'); return; }

    const vehicle = ownerVehicles.find(v => String(v.id) === String(contractForm.vehicle_id));
    const text = generateContractText(vehicle, selectedDriver, currentUser, contractForm);
    setContractPreviewText(text);
    setShowContractPreview(true);
  };

  const handleSendContract = async () => {
    if (!selectedDriver || !currentUser) return;
    setSendingContract(true);
    try {
      const { data: rental, error } = await supabase.from('rentals').insert([{
        vehicle_id:     contractForm.vehicle_id,
        owner_id:       currentUser.id,
        driver_id:      selectedDriver.id,
        start_date:     contractForm.start_date,
        end_date:       contractForm.end_date,
        status:         'awaiting_driver_confirmation',
        price_per_week: parseFloat(contractForm.price_per_week),
        deposit:        parseFloat(contractForm.deposit) || 0,
        message:        contractForm.message || '',
        contract_text:  contractPreviewText,
      }]).select().single();
      if (error) throw error;

      // Notify the driver in-app
      try {
        await notify(
          selectedDriver.id,
          'rental_contract',
          'New Rental Contract',
          `${currentUser?.full_name?.split(' ')[0] || 'An owner'} has sent you a rental contract. Open your dashboard to review and confirm.`,
          { owner_id: currentUser?.id }
        );
      } catch { /* notification failure must never block the main flow */ }

      toast.success(`Contract sent to ${selectedDriver.full_name?.split(' ')[0] || 'driver'}! They'll confirm on their dashboard.`);
      setSelectedDriver(null);
      setShowContractForm(false);
      setShowContractPreview(false);
      setContractPreviewText('');
    } catch (err) {
      toast.error('Failed to send contract: ' + (err.message || 'please try again'));
    } finally {
      setSendingContract(false);
    }
  };

  const isOwner = isCurrentUserAdmin || currentUser?.account_type === 'owner' || currentUser?.account_type === 'both';
  const isSearching = isLoading || geocoding;

  const clearFilters = () => {
    setGeocodeTarget('');
    setFilters({ location: selectedProvince?.city || '', minExperience: 0, minRating: 0, radius: SEARCH_RADIUS_KM });
    setLocationCoords(autoLocationRef.current);
    setRpcDrivers(null);
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Find Drivers"
        subtitle={
          !hasSearched
            ? 'Choose a province to see nearby drivers'
            : geocoding
              ? 'Locating…'
              : `${drivers.length} driver${drivers.length !== 1 ? 's' : ''} within ${filters.radius} km of ${selectedProvince?.isUserLocation ? 'your location' : (selectedProvince?.city || filters.location)}`
        }
        backTo="/home"
        action={
          hasSearched && (
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-2">
              <SlidersHorizontal className="w-4 h-4" /> Filters
            </Button>
          )
        }
      />

      {!hasSearched ? (
        <ProvinceBrowser mode="drivers" onSelectProvince={handleSelectProvince} />
      ) : (
      <>
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
                placeholder="e.g. Soweto — finds nearby drivers too"
                value={filters.location}
                onChange={e => setFilters(p => ({ ...p, location: e.target.value }))}
                onBlur={e => setGeocodeTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setGeocodeTarget(e.currentTarget.value); e.currentTarget.blur(); } }}
              />
              {locationCoords && (
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">
                  Searching near: {locationCoords.latitude.toFixed(4)}°,{' '}
                  {locationCoords.longitude.toFixed(4)}°
                  {locationCoords.displayName ? ` — ${locationCoords.displayName}` : ''}
                </p>
              )}
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
                  min={5}
                  max={200}
                  step={5}
                  value={[filters.radius]}
                  onValueChange={([v]) => setFilters(p => ({ ...p, radius: v }))}
                />
              </div>
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
                    <div
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0 overflow-hidden cursor-zoom-in"
                      onClick={(e) => { const av = avatarMap[d.id]; if (av?.avatar_visible !== false && av?.avatar_url) { e.stopPropagation(); setLightboxSrc(av.avatar_url); } }}
                    >
                      {(() => { const av = avatarMap[d.id]; return av?.avatar_visible !== false && av?.avatar_url
                        ? <img src={av.avatar_url} alt="" className="w-full h-full object-cover pointer-events-none" />
                        : (d.full_name?.[0] || '?'); })()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-foreground text-sm truncate">{d.full_name || 'Driver'}</h4>
                        {(d.verification_badge === 'fully_verified' || d.verification_badge === 'id_verified') && (
                          <span className="text-xs text-green-600 font-medium leading-none">✅ ID</span>
                        )}
                        {(d.verification_badge === 'fully_verified' || d.verification_badge === 'dl_verified' || d.verification_badge === 'licence_only') && (
                          <span className="text-xs text-blue-600 font-medium leading-none">🛡️ DL</span>
                        )}
                        {!d.verification_badge && d.verified && <ShieldCheck className="w-4 h-4 text-primary shrink-0" />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                        {d.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{d.location}</span>}
                        {exp > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{exp}y exp</span>}
                        {d.rating > 0 && <StarRating value={Math.round(d.rating)} size="sm" showValue />}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs px-2.5 py-1.5"
                    onClick={(e) => { e.stopPropagation(); openDriverDetail(d); }}
                  >
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
      <div className="mt-4 text-center">
        <button onClick={backToProvinces} className="text-xs text-primary hover:underline">
          ← Browse a different province
        </button>
      </div>
      </>
      )}

      {/* ── Driver Detail Modal ──────────────────────────────────────────────── */}
      {selectedDriver && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => { setSelectedDriver(null); setShowContractForm(false); }}>
          <div
            className="bg-card rounded-2xl shadow-xl w-full max-w-md border border-border flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto p-6 flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold truncate">Driver Profile</h2>
                <button onClick={() => { setSelectedDriver(null); setShowContractForm(false); }} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary shrink-0 overflow-hidden cursor-zoom-in"
                  onClick={() => { const av = avatarMap[selectedDriver.id]; if (av?.avatar_visible !== false && av?.avatar_url) setLightboxSrc(av.avatar_url); }}
                >
                  {(() => { const av = avatarMap[selectedDriver.id]; return av?.avatar_visible !== false && av?.avatar_url
                    ? <img src={av.avatar_url} alt="" className="w-full h-full object-cover pointer-events-none" />
                    : (selectedDriver.full_name?.[0] || '?'); })()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-lg truncate">{selectedDriver.full_name || 'Driver'}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    {(selectedDriver.verification_badge === 'fully_verified' || selectedDriver.verification_badge === 'id_verified') && (
                      <span className="text-xs text-green-600 font-medium">✅ ID Verified</span>
                    )}
                    {(selectedDriver.verification_badge === 'fully_verified' || selectedDriver.verification_badge === 'dl_verified' || selectedDriver.verification_badge === 'licence_only') && (
                      <span className="text-xs text-blue-600 font-medium">🛡️ DL Verified</span>
                    )}
                    {!selectedDriver.verification_badge && selectedDriver.verified && (
                      <span className="text-xs text-green-600 font-medium">✅ Verified</span>
                    )}
                    {!selectedDriver.verification_badge && !selectedDriver.verified && (
                      <span className="text-xs text-amber-600 font-medium">⏳ Pending verification</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {selectedDriver.location && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium truncate ml-4">{selectedDriver.location}</span>
                  </div>
                )}
                {selectedDriver.license_year && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Experience</span>
                    <span className="font-medium">{currentYear - selectedDriver.license_year} years</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rating</span>
                  <span><StarRating value={Math.round(selectedDriver.rating || 0)} size="sm" showValue /></span>
                </div>
              </div>

              <div className="mt-4">
                {loadingReviews ? (
                  <p className="text-xs text-muted-foreground">Loading reviews...</p>
                ) : driverReviews.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Recent Reviews</p>
                    {driverReviews.map(review => (
                      <div key={review.id} className="p-3 rounded-xl bg-muted/50 border border-border/30 break-words">
                        <div className="flex items-center gap-2 mb-1">
                          <StarRating value={review.rating} size="sm" />
                          <span className="text-xs text-muted-foreground">{new Date(review.created_at).toLocaleDateString()}</span>
                        </div>
                        {review.comment && <p className="text-xs text-foreground">{review.comment}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No reviews yet.</p>
                )}
              </div>

              {isOwner && canSendContract && selectedDriver.id !== currentUser?.id && (
                <div className="mt-5 border-t border-border pt-4">
                  <button
                    className="flex items-center justify-between w-full text-sm font-semibold text-foreground hover:text-primary transition-colors"
                    onClick={() => setShowContractForm(v => !v)}
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Send Rental Contract
                    </span>
                    {showContractForm ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {showContractForm && (
                    <div className="mt-4 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Use this after agreeing on terms via Messages. The driver will see the contract on their dashboard and confirm to activate the rental.
                      </p>

                      {ownerVehicles.length === 0 ? (
                        <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                          You have no vehicles listed. Add a vehicle first to send a contract.
                        </p>
                      ) : (
                        <div>
                          <Label className="text-xs">Vehicle</Label>
                          <Select
                            value={contractForm.vehicle_id}
                            onValueChange={v => {
                              const veh = ownerVehicles.find(x => String(x.id) === v);
                              setContractForm(f => ({
                                ...f,
                                vehicle_id:     v,
                                price_per_week: veh?.price_per_week ? String(veh.price_per_week) : f.price_per_week,
                                deposit:        veh?.deposit ? String(veh.deposit) : f.deposit,
                              }));
                            }}
                          >
                            <SelectTrigger className="mt-1"><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
                            <SelectContent>
                              {ownerVehicles.map(v => (
                                <SelectItem key={v.id} value={String(v.id)}>
                                  {v.make} {v.model} {v.year ? `(${v.year})` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Start Date</Label>
                          <Input className="mt-1" type="date" value={contractForm.start_date} onChange={e => setContractForm(f => ({ ...f, start_date: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">End Date</Label>
                          <Input className="mt-1" type="date" value={contractForm.end_date} onChange={e => setContractForm(f => ({ ...f, end_date: e.target.value }))} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Weekly Rate (R)</Label>
                          <Input className="mt-1" type="number" min="0" placeholder="e.g. 1200" value={contractForm.price_per_week} onChange={e => setContractForm(f => ({ ...f, price_per_week: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">Deposit (R)</Label>
                          <Input className="mt-1" type="number" min="0" placeholder="e.g. 500" value={contractForm.deposit} onChange={e => setContractForm(f => ({ ...f, deposit: e.target.value }))} />
                        </div>
                      </div>

                      {estimate && contractForm.price_per_week && (
                        <div className="bg-muted rounded-lg p-3 text-xs">
                          {estimate.weeks} week{estimate.weeks !== 1 ? 's' : ''} × R {contractForm.price_per_week} = <span className="font-bold text-foreground">R {estimate.total}</span>
                          {contractForm.deposit ? <span className="text-muted-foreground"> + R {contractForm.deposit} deposit</span> : null}
                        </div>
                      )}

                      <div>
                        <Label className="text-xs">Note to Driver (optional)</Label>
                        <textarea
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                          rows={2}
                          placeholder="Any final notes or conditions agreed in your chat..."
                          value={contractForm.message}
                          onChange={e => setContractForm(f => ({ ...f, message: e.target.value }))}
                        />
                      </div>

                      <Button
                        className="w-full gap-2"
                        disabled={ownerVehicles.length === 0}
                        onClick={handlePreviewContract}
                      >
                        <FileText className="w-4 h-4" /> Preview Contract Before Sending
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 pb-6 shrink-0">
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={() => {
                  setSelectedDriver(null);
                  setShowContractForm(false);
                  navigate(`/messages?userId=${selectedDriver.id}`);
                }}
              >
                <MessageCircle className="w-4 h-4" /> Message {selectedDriver.full_name?.split(' ')[0] || 'Driver'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {/* Contract Preview Modal */}
      {showContractPreview && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowContractPreview(false)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-6 border border-border flex flex-col max-h-[92vh]"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-1 shrink-0">
              <h2 className="text-xl font-bold">Draft & Send Contract</h2>
              <button onClick={() => setShowContractPreview(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-3 shrink-0">
              Review and edit the contract below before sending to {selectedDriver?.full_name?.split(' ')[0] || 'the driver'}. Once sent, the driver will review and accept.
            </p>

            <div className="bg-background border-2 border-primary/30 rounded-xl p-3 flex-1 overflow-y-auto mb-4 min-h-0">
              <p className="text-[10px] text-primary font-medium mb-2 uppercase tracking-wide">✏️ Editable — tap to make changes</p>
              <textarea
                className="w-full h-full min-h-[50vh] bg-transparent text-sm font-mono resize-none outline-none leading-relaxed"
                value={contractPreviewText}
                onChange={e => setContractPreviewText(e.target.value)}
              />
            </div>

            <div className="flex gap-3 shrink-0">
              <Button variant="outline" className="flex-1" onClick={() => setShowContractPreview(false)}>
                Back to Edit
              </Button>
              <Button
                className="flex-1 gap-2"
                disabled={sendingContract}
                onClick={handleSendContract}
              >
                {sendingContract
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><FileText className="w-4 h-4" /> Send to {selectedDriver?.full_name?.split(' ')[0] || 'Driver'}</>}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
