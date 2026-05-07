import React, { useState, useEffect } from 'react';
import { auth, Vehicle } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { Search, SlidersHorizontal, X, Lock } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/layout/PageHeader';
import VehicleCard from '@/components/vehicles/VehicleCard';
import EmptyState from '@/components/common/EmptyState';

export default function SearchVehicles() {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    type: 'all',
    maxPrice: 2000,
    location: '',
    minRating: 0,
  });
  const [user, setUser] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['search-vehicles'],
    queryFn: () => Vehicle.filter({ status: 'available' }),
  });

  const filtered = vehicles.filter(v => {
    if (v.created_by === user?.email) return false;
    if (filters.type !== 'all' && v.vehicle_type !== filters.type) return false;
    if (v.price_per_week > filters.maxPrice) return false;
    if (filters.location && !v.location?.toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.minRating > 0 && (v.rating || 0) < filters.minRating) return false;
    return true;
  });

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Find Vehicles"
        subtitle={`${filtered.length} vehicle${filtered.length !== 1 ? 's' : ''} available`}
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
            <Button variant="ghost" size="sm" onClick={() => setFilters({ type: 'all', maxPrice: 2000, location: '', minRating: 0 })}>
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
              <Label className="text-xs">Location</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Johannesburg"
                value={filters.location}
                onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value }))}
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
                onValueChange={([v]) => setFilters(prev => ({ ...prev, maxPrice: v }))}
              />
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
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(v => {
            const canInteract = user?.subscription_active && user?.verified;
            if (canInteract) {
              return (
                <Link key={v.id} to={`/rental-request?vehicleId=${v.id}`}>
                  <VehicleCard vehicle={v} />
                </Link>
              );
            }
            return (
              <div key={v.id} onClick={() => toast.warning('You must be subscribed and verified to request a rental')} className="cursor-pointer">
                <div className="relative">
                  <VehicleCard vehicle={v} />
                  <div className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" /> Subscribe to rent
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="🔍" title="No vehicles found" description="Try adjusting your filters" />
      )}
    </div>
  );
}