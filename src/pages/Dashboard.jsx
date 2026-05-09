import React, { useState, useEffect, useRef } from 'react';
import { auth, Vehicle, Rental } from '@/api/supabaseData';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Plus, Search, MapPin, Bike, Users, Car, Crown, ShieldCheck, AlertTriangle,
  Check, X, User as UserIcon, MessageCircle
} from 'lucide-react';
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
  const [reviewModal, setReviewModal] = useState(null);

  // Refs for scrolling
  const ownerVehiclesRef = useRef(null);
  const ownerAssignmentsRef = useRef(null);
  const driverAvailableRef = useRef(null);
  const driverActiveRentalsRef = useRef(null);
  const reviewsSectionRef = useRef(null);
  const tabsRef = useRef(null);

  const [bothTab, setBothTab] = useState('owner');

  // Driver detail popup state
  const [selectedDriver, setSelectedDriver] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const queryClient = useQueryClient();

  const { data: vehicles = [] } = useQuery({
    queryKey: ['my-vehicles'],
    queryFn: () => Vehicle.filter({ owner_id: user?.id }),
    enabled: !!user?.id,
  });

  const { data: allVehicles = [] } = useQuery({
    queryKey: ['all-vehicles'],
    queryFn: () => Vehicle.filter({ status: 'available' }),
  });

  // Fetch rentals – filter by owner_id or driver_id
  const { data: rentals = [] } = useQuery({
    queryKey: ['my-rentals'],
    queryFn: async () => {
      const all = await Rental.list();
      return all.filter(r => r.owner_id === user?.id || r.driver_id === user?.id);
    },
    enabled: !!user?.id,
  });

  const availableForMe = allVehicles.filter(v => v.created_by !== user?.email);
  const activeRentals = rentals.filter(r => r.status === 'active' || r.status === 'pending');
  const completedRentals = rentals.filter(r => r.status === 'completed');

  // Owner‑specific rental slices
  const ownerRentals = rentals.filter(r => r.owner_id === user?.id);
  const ownerPendingRentals = ownerRentals.filter(r => r.status === 'pending');
  const ownerActiveRentals = ownerRentals.filter(r => r.status === 'active');

  // Driver‑specific rental slice
  const driverActiveRentals = rentals.filter(r => r.driver_id === user?.id && r.status === 'active');

  const accountType = user?.subscription_plan || 'driver';

  const scrollToSection = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const navigateToBothSection = (tab, ref) => {
    setBothTab(tab);
    setTimeout(() => {
      scrollToSection(ref);
    }, 100);
  };

  // Accept / reject proposal
  const handleProposalResponse = async (rentalId, action) => {
    try {
      const rental = rentals.find(r => r.id === rentalId);
      if (!rental) return;

      if (action === 'accept') {
        await Rental.update(rentalId, { status: 'active' });
        await Vehicle.update(rental.vehicle_id, { status: 'rented' });
        toast.success('Proposal accepted! Vehicle assigned.');
      } else {
        await Rental.update(rentalId, { status: 'rejected' });
        toast.success('Proposal rejected.');
      }

      // Invalidate queries to refresh
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
    } catch (err) {
      toast.error('Failed to update proposal: ' + err.message);
    }
  };

  // ─────────────── Owner Content ───────────────
  const renderOwnerContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3" ref={ownerVehiclesRef}>My Listed Vehicles</h3>
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

      <h3 className="text-lg font-semibold mb-3 mt-8" ref={ownerAssignmentsRef}>Active Assignments</h3>

      {/* Pending proposals */}
      {ownerPendingRentals.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-2">PENDING PROPOSALS</p>
          <div className="space-y-3">
            {ownerPendingRentals.map(r => {
              const vehicle = allVehicles.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id);
              const driver = r.driver_id ? users.find(u => u.id === r.driver_id) : null;
              const driverName = driver?.full_name || r.driver_email || 'Driver';

              return (
                <Card key={r.id} className="p-4 border border-amber-200 bg-amber-50">
                  <div className="flex flex-col sm:flex-row justify-between gap-3">
                    <div>
                      <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : 'Rental'}</p>
                      <p className="text-xs text-muted-foreground">Driver: {driverName}</p>
                      <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                      <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                      {r.message && <p className="text-xs italic mt-1">"{r.message}"</p>}
                      <button
                        onClick={() => setSelectedDriver(driver)}
                        className="text-xs text-primary mt-1 underline"
                      >
                        View driver details
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1" onClick={(e) => { e.stopPropagation(); handleProposalResponse(r.id, 'accept'); }}>
                        <Check className="w-3.5 h-3.5" /> Accept
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={(e) => { e.stopPropagation(); handleProposalResponse(r.id, 'reject'); }}>
                        <X className="w-3.5 h-3.5" /> Reject
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Active assignments */}
      {user?.subscription_active ? (
        ownerActiveRentals.length > 0 ? (
          <div className="space-y-3">
            {ownerActiveRentals.map(r => {
              const vehicle = allVehicles.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id);
              const driverName = r.driver_email || 'Driver';
              return (
                <RentalCard
                  key={r.id}
                  rental={r}
                  vehicle={vehicle}
                  counterpartyName={driverName}
                />
              );
            })}
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

  // ─────────────── Driver Content ───────────────
  const renderDriverContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3" ref={driverAvailableRef}>Available Vehicles</h3>
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

      <h3 className="text-lg font-semibold mb-3 mt-8" ref={driverActiveRentalsRef}>My Active Rentals</h3>
      {driverActiveRentals.length > 0 ? (
        <div className="space-y-3">
          {driverActiveRentals.map(r => {
            const vehicle = allVehicles.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id);
            const ownerName = r.owner_email || 'Owner';
            return (
              <RentalCard
                key={r.id}
                rental={r}
                vehicle={vehicle}
                counterpartyName={ownerName}
              />
            );
          })}
        </div>
      ) : (
        <EmptyState icon="📋" title="No active rentals" description="You haven't rented any vehicles yet" />
      )}
    </>
  );

  // ─────────────── Stat Cards ───────────────
  const renderStatCards = () => {
    if (accountType === 'driver') {
      return (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
          <div onClick={() => scrollToSection(driverAvailableRef)} className="cursor-pointer">
            <StatCard icon={Search} label="Available Vehicles" value={availableForMe.length} subtitle="Vehicles near you" />
          </div>
          <div onClick={() => scrollToSection(driverActiveRentalsRef)} className="cursor-pointer">
            <StatCard icon={Bike} label="Active Rentals" value={driverActiveRentals.length} />
          </div>
          <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer">
            <StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} />
          </div>
        </div>
      );
    }

    if (accountType === 'both') {
      return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
          <div onClick={() => navigateToBothSection('owner', ownerVehiclesRef)} className="cursor-pointer">
            <StatCard icon={Car} label="My Vehicles" value={vehicles.length} />
          </div>
          <div onClick={() => navigateToBothSection('driver', driverAvailableRef)} className="cursor-pointer">
            <StatCard icon={Search} label="Available" value={availableForMe.length} subtitle="Vehicles near you" />
          </div>
          <div onClick={() => navigateToBothSection('owner', ownerAssignmentsRef)} className="cursor-pointer">
            <StatCard icon={Bike} label="Active Rentals" value={ownerActiveRentals.length + ownerPendingRentals.length} />
          </div>
          <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer">
            <StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} />
          </div>
        </div>
      );
    }

    // owner
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        <div onClick={() => scrollToSection(ownerVehiclesRef)} className="cursor-pointer">
          <StatCard icon={Car} label="My Vehicles" value={vehicles.length} />
        </div>
        <div onClick={() => scrollToSection(ownerAssignmentsRef)} className="cursor-pointer">
          <StatCard icon={Bike} label="Active Rentals" value={ownerActiveRentals.length + ownerPendingRentals.length} />
        </div>
        <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer">
          <StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} />
        </div>
      </div>
    );
  };

  const renderActionButtons = () => {
    const rowButtonClass = "w-full gap-1.5 py-3 text-xs lg:text-sm";
    const iconClass = "w-4 h-4";

    if (accountType === 'owner' || accountType === 'both') {
      const gridCols = accountType === 'both' ? 'grid-cols-3' : 'grid-cols-2';
      return (
        <div className="mt-6">
          <Link to="/add-vehicle" className="block w-full mb-2">
            <Button className="w-full gap-2 py-5 text-base">
              <Plus className={iconClass} /> Add Vehicle
            </Button>
          </Link>
          <div className={`grid gap-2 ${gridCols}`}>
            <Link to="/find-drivers">
              <Button variant="outline" className={rowButtonClass}>
                <Users className={iconClass} /> Find Drivers
              </Button>
            </Link>
            {accountType === 'both' && (
              <Link to="/search-vehicles">
                <Button variant="outline" className={rowButtonClass}>
                  <Search className={iconClass} /> Find Vehicles
                </Button>
              </Link>
            )}
            <Link to="/tracking">
              <Button variant="outline" className={rowButtonClass}>
                <MapPin className={iconClass} /> GPS Track
              </Button>
            </Link>
          </div>
        </div>
      );
    }

    if (accountType === 'driver') {
      return (
        <div className="grid grid-cols-2 gap-2 mt-6">
          <Link to="/search-vehicles">
            <Button className="w-full gap-2 py-4 text-sm">
              <Search className="w-4 h-4" /> Find Vehicles
            </Button>
          </Link>
          <Link to="/tracking">
            <Button variant="outline" className="w-full gap-2 py-4 text-sm">
              <MapPin className="w-4 h-4" /> GPS Track
            </Button>
          </Link>
        </div>
      );
    }

    return null;
  };

  // ─────────────── Driver Detail Modal ───────────────
  const currentYear = new Date().getFullYear();

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

      {renderStatCards()}
      {renderActionButtons()}

      <div className="mt-8" ref={tabsRef}>
        {accountType === 'both' ? (
          <Tabs value={bothTab} onValueChange={setBothTab}>
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
        <div className="mt-8" ref={reviewsSectionRef}>
          <h3 className="text-lg font-semibold mb-3">Completed Rentals</h3>
          <div className="space-y-3">
            {completedRentals.map(r => {
              const isOwner = r.owner_id === user?.id;
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

      {/* Driver Detail Modal */}
      {selectedDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setSelectedDriver(null)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Driver Profile</h2>
              <button onClick={() => setSelectedDriver(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                {selectedDriver.full_name?.[0] || '?'}
              </div>
              <div>
                <p className="font-semibold text-lg">{selectedDriver.full_name || 'Driver'}</p>
                <p className="text-sm text-muted-foreground">{selectedDriver.email}</p>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {selectedDriver.phone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="font-medium">{selectedDriver.phone}</span>
                </div>
              )}
              {selectedDriver.location && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span className="font-medium">{selectedDriver.location}</span>
                </div>
              )}
              {selectedDriver.license_year && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Experience</span>
                  <span className="font-medium">{currentYear - selectedDriver.license_year} years</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Verified</span>
                <span>{selectedDriver.verified ? '✅ Verified' : '⏳ Pending'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rating</span>
                <span><StarRating value={Math.round(selectedDriver.rating || 0)} size="sm" showValue /></span>
              </div>
            </div>

            <Button
              className="w-full mt-6 gap-2"
              onClick={() => {
                setSelectedDriver(null);
                navigate(`/messages?userId=${selectedDriver.id}`);
              }}
            >
              <MessageCircle className="w-4 h-4" /> Message {selectedDriver.full_name?.split(' ')[0]}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
