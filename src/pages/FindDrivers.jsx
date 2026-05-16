import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, auth, fetchProfilesByIds } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, MessageCircle, ShieldCheck, SlidersHorizontal, X, Lock, User as UserIcon } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import StarRating from '@/components/reviews/StarRating';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';

export default function FindDrivers() {
  const navigate = useNavigate();
  const [driverReviews, setDriverReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ location: '', minExperience: 0, minRating: 0, radius: 50 });
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  // avatarMap: userId → { avatar_url, avatar_visible } from the service-role
  // Netlify function so photos stored in auth metadata are visible to others.
  const [avatarMap, setAvatarMap] = useState({});

  useEffect(() => {
    auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => User.list(),
  });

  // Enrich driver list with avatar data via service-role Netlify function.
  // Runs once after the user list loads.
  useEffect(() => {
    if (!users.length) return;
    fetchProfilesByIds(users.map((u) => u.id))
      .then((enriched) => {
        const map = {};
        enriched.forEach((p) => { map[p.id] = p; });
        setAvatarMap(map);
      })
      .catch(() => {});
  }, [users]);

  const currentYear = new Date().getFullYear();
  const drivers = users.filter(u => {
    if (u.account_type !== 'driver' && u.account_type !== 'both') return false;
    if (filters.location && !(u.location || '').toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.minExperience > 0 && u.license_year && (currentYear - u.license_year) < filters.minExperience) return false;
    if (filters.minRating > 0 && (u.rating || 0) < filters.minRating) return false;
    return true;
  });

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
    fetchDriverReviews(driver.id);
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Find Drivers"
        subtitle={`${drivers.length} driver${drivers.length !== 1 ? 's' : ''} found`}
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
            <Button variant="ghost" size="sm" onClick={() => setFilters({ location: '', minExperience: 0, minRating: 0, radius: 50 })}>
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Location</Label>
              <Input className="mt-1" placeholder="e.g. Soweto" value={filters.location} onChange={e => setFilters(p => ({ ...p, location: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Min Experience (years)</Label>
              <Input className="mt-1" type="number" min="0" value={filters.minExperience || ''} onChange={e => setFilters(p => ({ ...p, minExperience: parseInt(e.target.value) || 0 }))} />
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
              <Label className="text-xs">Search Radius: <span className="font-semibold text-foreground">{filters.radius} km</span></Label>
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
        </Card>
      )}

      {isLoading ? (
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
                      {(() => { const av = avatarMap[d.id]; return av?.avatar_visible !== false && av?.avatar_url
                        ? <img src={av.avatar_url} alt="" className="w-full h-full object-cover" />
                        : (d.full_name?.[0] || '?'); })()}
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
        <EmptyState icon="👤" title="No drivers found" description="Try adjusting your search filters" />
      )}

      {/* ---------- Driver Detail Modal ---------- */}
      {selectedDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setSelectedDriver(null)}>
          <div
            className="bg-card rounded-2xl shadow-xl w-full max-w-md p-6 border border-border max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold truncate">Driver Profile</h2>
              <button onClick={() => setSelectedDriver(null)} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary shrink-0 overflow-hidden">
                {(() => { const av = avatarMap[selectedDriver.id]; return av?.avatar_visible !== false && av?.avatar_url
                  ? <img src={av.avatar_url} alt="" className="w-full h-full object-cover" />
                  : (selectedDriver.full_name?.[0] || '?'); })()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-lg truncate">{selectedDriver.full_name || 'Driver'}</p>
                {selectedDriver.verified
                  ? <span className="text-xs text-green-600 font-medium">✅ Verified</span>
                  : <span className="text-xs text-amber-600 font-medium">⏳ Pending verification</span>}
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

            {/* Reviews Section */}
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

            <Button
              className="w-full mt-6 gap-2"
              onClick={() => {
                setSelectedDriver(null);
                navigate(`/messages?userId=${selectedDriver.id}`);
              }}
            >
              <MessageCircle className="w-4 h-4" /> Contact {selectedDriver.full_name?.split(' ')[0]}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
