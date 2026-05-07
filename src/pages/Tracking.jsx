import React, { useState, useEffect } from 'react';
import { auth, Vehicle } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Navigation, Clock, AlertTriangle, Radio } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import VehicleCard from '@/components/vehicles/VehicleCard';
import EmptyState from '@/components/common/EmptyState';
import { toast } from 'sonner';

export default function Tracking() {
  const [user, setUser] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: vehicles = [] } = useQuery({
    queryKey: ['my-vehicles'],
    queryFn: () => Vehicle.filter({ created_by: user?.email }),
    enabled: !!user?.email,
  });

  const rentedVehicles = vehicles.filter(v => v.status === 'rented' || v.status === 'active');

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader title="GPS Tracking" subtitle="Monitor your rented vehicles" backTo="/" />

      {rentedVehicles.length > 0 ? (
        <>
          <div className="space-y-3 mb-6">
            {rentedVehicles.map(v => (
              <div
                key={v.id}
                onClick={() => setSelectedVehicle(v)}
                className={`cursor-pointer rounded-xl transition-all ${selectedVehicle?.id === v.id ? 'ring-2 ring-primary' : ''}`}
              >
                <VehicleCard vehicle={v} showPrice={false} />
              </div>
            ))}
          </div>

          <div className="bg-muted rounded-2xl h-52 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border mb-6">
            <MapPin className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground font-medium">
              {selectedVehicle ? `Tracking: ${selectedVehicle.make} ${selectedVehicle.model}` : 'Select a vehicle to track'}
            </p>
            <p className="text-xs text-muted-foreground">Map integration coming soon</p>
          </div>

          {selectedVehicle && (
            <div className="space-y-3">
              <Card className="p-4 border border-border/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Navigation className="w-4 h-4 text-primary" />
                  </div>
                  <h4 className="font-semibold">Location Details</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium">{selectedVehicle.location}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Speed</span>
                    <span className="font-medium">-- km/h</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Updated</span>
                    <span className="font-medium flex items-center gap-1">
                      <Radio className="w-3 h-3 text-emerald-500" />
                      Just now
                    </span>
                  </div>
                </div>
              </Card>

              <Card className="p-4 border-l-4 border-l-amber-400 border border-border/50">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <div>
                    <h4 className="font-semibold text-sm">Alerts</h4>
                    <p className="text-xs text-muted-foreground">No alerts at this time</p>
                  </div>
                </div>
              </Card>

              <Button
                variant="destructive"
                className="w-full"
                onClick={() => toast.success('Alert sent to support!')}
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                Report Issue
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon="📍"
          title="No vehicles to track"
          description="Your rented-out vehicles will appear here for GPS tracking"
        />
      )}
    </div>
  );
}