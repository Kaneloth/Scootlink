import React, { useState, useEffect } from 'react';
import { auth, Vehicle, Rental } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Plus, Search, MapPin, Bike, Users, Car, Crown, ShieldCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/dashboard/StatCard';
import WalletCard from '@/components/dashboard/WalletCard';
import VehicleCard from '@/components/vehicles/VehicleCard';
import RentalCard from '@/components/dashboard/RentalCard';
import EmptyState from '@/components/common/EmptyState';
import SubscriptionGate from '@/components/subscription/SubscriptionGate';
import LeaveReviewModal from '@/components/reviews/LeaveReviewModal';
import StarRating from '@/components/reviews/StarRating';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [reviewModal, setReviewModal] = useState(null); // { rental, targetEmail, targetName, targetType }

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: vehicles = [] } = useQuery({
    queryKey: ['my-vehicles'],
    queryFn: () => Vehicle.filter({ owner_id: user?.id }),
    enabled: !!user?.id,
  });

  const { data: allVehicles = [] } = useQuery({
    queryKey: ['all-vehicles'],
    queryFn: () => Vehicle.filter({ status: 'available' }),
  });

  const { data: rentals = [] } = useQuery({
    queryKey: ['my-rentals'],
    queryFn: async () => {
      const all = await Rental.list();
      return all.filter(r => r.owner_email === user?.email || r.driver_email === user?.email);
    },
    enabled: !!user?.email,
  });

  const availableForMe = allVehicles.filter(v => v.created_by !== user?.email);
  const activeRentals = rentals.filter(r => r.status === 'active' || r.status === 'pending');
  const completedRentals = rentals.filter(r => r.status === 'completed');
  const accountType = user?.user_metadata?.subscription_plan || 'driver';

  // ---------- Owner content ----------
  const renderOwnerContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3">My Listed Vehicles</h3>
      {vehicles.length > 0 ? (
        <div className="space-y-3">
          {vehicles.map(v => (
            <Link key={v.id} to={`/edit-vehicle?id=${v.id}`}>
              <VehicleCard vehicle={v} />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🚗"
          title="No vehicles listed"
          description="Add your first vehicle to start earning"
          action={
            <Link to="/add-vehicle">
              <Button size="sm"><Plus className="w-4 h-4 mr-1" />Add Vehicle</Button>
            </Link>
          }
        />
      )}

      <h3 className="text-lg font-semibold mb-3 mt-8">Active Assignments</h3>
      {user?.subscription_active ? (
        activeRentals.filter(r => r.owner_email === user?.email).length > 0 ? (
          <div className="space-y-3">
            {activeRentals.filter(r => r.owner_email === user?.email).map(r => (
              <RentalCard
                key={r.id}
                rental={r}
                vehicle={vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id)}
                counterpartyName={r.driver_email}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon="📋" title="No active assignments" description="When drivers rent your vehicles, they'll appear here" />
        )
      ) : (
        <Card className="p-4 border border-primary/20 bg-primary/5 flex items-center gap-3">
          <Crown className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Subscribe to manage rental assignments</p>
            <p className="text-xs text-muted-foreground">Plans from R 49/month</p>
          </div>
          <Link to="/subscription"><Button size="sm">Subscribe</Button></Link>
        </Card>
      )}
    </>
  );

  // ---------- Driver content ----------
  const renderDriverContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3">Available Vehicles</h3>
      {availableForMe.length > 0 ? (
        <div className="space-y-3">
          {availableForMe.map(v => {
            const canRent = user?.subscription_active && user?.verified;
            if (canRent) {
              return (
                <Link key={v.id} to={`/rental-request?vehicleId=${v.id}`}>
                  <VehicleCard vehicle={v} />
                </Link>
              );
            }
            return (
              <div key={v.id} onClick={() => toast.warning('Subscribe and complete verification to rent vehicles')} className="cursor-pointer">
                <VehicleCard vehicle={v} />
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="🔍" title="No available vehicles" description="Check back later for new listings" />
      )}
    </>
  );

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title={`Welcome${user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}`}
        subtitle="Manage your vehicles and rentals"
      />

      {/* Onboarding prompt */}
      {user && !user.onboarding_completed && (
        <Card className="p-4 border-2 border-amber-300 bg-amber-50 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Complete your profile to get started</p>
              <p className="text-xs text-amber-700">Identity verification required before using Scootlink</p>
            </div>
          </div>
          <Link to="/onboarding">
            <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600">Set Up</Button>
          </Link>
        </Card>
      )}

      {/* Subscription prompt */}
      {user && user.onboarding_completed && !user.subscription_active && (
        <Card className="p-4 border-2 border-primary/30 bg-primary/5 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Crown className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Subscribe to unlock full access</p>
              <p className="text-xs text-muted-foreground">Plans from R 49/month</p>
            </div>
          </div>
          <Link to="/subscription">
            <Button size="sm" className="shrink-0">Subscribe</Button>
          </Link>
        </Card>
      )}

      <WalletCard balance={user?.wallet_balance || 0} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
        <StatCard icon={Car} label="My Vehicles" value={vehicles.length} />
        <StatCard icon={Bike} label="Active Rentals" value={activeRentals.length} />
        <StatCard icon={Search} label="Available" value={availableForMe.length} subtitle="Vehicles near you" />
        <StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} />
      </div>

      {/* Owner‑only action buttons – mobile friendly */}
      {(accountType === 'owner' || accountType === 'both') && (
        <div className="mt-6">
          {/* Full‑width Add Vehicle button */}
          <Link to="/add-vehicle" className="block w-full mb-2">
            <Button className="w-full gap-2 py-6 text-base">
              <Plus className="w-5 h-5" /> Add Vehicle
            </Button>
          </Link>
          {/* Two side‑by‑side buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Link to="/find-drivers">
              <Button variant="outline" className="w-full gap-2 py-4">
                <Users className="w-5 h-5" /> Find Drivers
              </Button>
            </Link>
            <Link to="/tracking">
              <Button variant="outline" className="w-full gap-2 py-4">
                <MapPin className="w-5 h-5" /> GPS Track
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Role‑based content */}
      <div className="mt-8">
        {accountType === 'both' ? (
          <Tabs defaultValue="owner">
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="owner">Owner</TabsTrigger>
              <TabsTrigger value="driver">Driver</TabsTrigger>
            </TabsList>
            <TabsContent value="owner" className="mt-4">
              {renderOwnerContent()}
            </TabsContent>
            <TabsContent value="driver" className="mt-4">
              {renderDriverContent()}
            </TabsContent>
          </Tabs>
        ) : accountType === 'owner' ? (
          <div>{renderOwnerContent()}</div>
        ) : (
          <div>{renderDriverContent()}</div>
        )}
      </div>

      {/* Completed rentals — leave review */}
      {completedRentals.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-3">Completed Rentals</h3>
          <div className="space-y-3">
            {completedRentals.map(r => {
              const isOwner = r.owner_email === user?.email;
              const targetEmail = isOwner ? r.driver_email : r.owner_email;
              const targetType = isOwner ? 'driver' : 'owner';
              const v = [...vehicles, ...allVehicles].find(v => v.id === r.vehicle_id);
              return (
                <Card key={r.id} className="p-4 border border-border/50 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{v ? `${v.make} ${v.model}` : 'Rental'}</p>
                    <p className="text-xs text-muted-foreground">{isOwner ? 'Driver: ' : 'Owner: '}{targetEmail}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    onClick={() => setReviewModal({ rental: r, targetEmail, targetName: targetEmail, targetType })}
                  >
                    <StarRating value={0} size="sm" /> Rate
                  </Button>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {reviewModal && (
        <LeaveReviewModal
          open={!!reviewModal}
          onClose={() => setReviewModal(null)}
          rental={reviewModal.rental}
          currentUser={user}
          targetEmail={reviewModal.targetEmail}
          targetName={reviewModal.targetName}
          targetType={reviewModal.targetType}
        />
      )}
    </div>
  );
}
