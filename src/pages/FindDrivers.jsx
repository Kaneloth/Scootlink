import React, { useState, useEffect } from 'react';
import { User, auth } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, MessageCircle, ShieldCheck, SlidersHorizontal, X, Lock } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import StarRating from '@/components/reviews/StarRating';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import { toast } from 'sonner';

export default function FindDrivers() {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ location: '', minExperience: 0, minRating: 0, radius: 50 });
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => User.list(),
  });

  const currentYear = new Date().getFullYear();
  const drivers = users.filter(u => {
    if (u.account_type !== 'driver' && u.account_type !== 'both') return false;
    if (filters.location && !(u.location || '').toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.minExperience > 0 && u.license_year && (currentYear - u.license_year) < filters.minExperience) return false;
    if (filters.minRating > 0 && (u.rating || 0) < filters.minRating) return false;
    return true;
  });

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
              <Card key={d.id} className="p-4 border border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                      {d.full_name?.[0] || '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-foreground">{d.full_name || 'Driver'}</h4>
                        {d.verified && <ShieldCheck className="w-4 h-4 text-primary" />}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        {d.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{d.location}</span>}
                        {exp > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{exp}y exp</span>}
                        {d.rating > 0 && <StarRating value={Math.round(d.rating)} size="sm" showValue />}
                      </div>
                    </div>
                  </div>
                  {currentUser?.subscription_active && currentUser?.verified ? (
                    <Button size="sm" variant="outline" onClick={() => toast.info('Contact feature coming soon')}>
                      <MessageCircle className="w-3 h-3 mr-1" /> Contact
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled title="Subscribe & verify to contact drivers">
                      <Lock className="w-3 h-3 mr-1" /> Contact
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="👤" title="No drivers found" description="Try adjusting your search filters" />
      )}
    </div>
  );
}