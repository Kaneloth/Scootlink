import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth, Vehicle, Rental, supabase } from '@/api/supabaseData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import LeaveReviewModal from '@/components/reviews/LeaveReviewModal';
import StarRating from '@/components/reviews/StarRating';

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [reviewModal, setReviewModal] = useState(null);  // { rental, targetEmail, targetName, targetType }
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [loadingDriver, setLoadingDriver] = useState(false);

  // Contract modal states
  const [contractModal, setContractModal] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [contractAgreed, setContractAgreed] = useState(false);

  const ownerVehiclesRef = useRef(null);
  const ownerAssignmentsRef = useRef(null);
  const driverAvailableRef = useRef(null);
  const driverActiveRentalsRef = useRef(null);
  const reviewsSectionRef = useRef(null);
  const tabsRef = useRef(null);

  const [bothTab, setBothTab] = useState('owner');

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

  const { data: rentals = [] } = useQuery({
    queryKey: ['my-rentals'],
    queryFn: async () => {
      const all = await Rental.list();
      return all.filter(r => r.owner_id === user?.id || r.driver_id === user?.id);
    },
    enabled: !!user?.id,
  });

  const availableForMe = allVehicles.filter(v => v.owner_id !== user?.id);
  const completedRentals = rentals.filter(r => r.status === 'completed');

  const ownerRentals = rentals.filter(r => r.owner_id === user?.id);
  const ownerPendingRentals = ownerRentals.filter(r => r.status === 'pending');
  const ownerActiveRentals = ownerRentals.filter(r => r.status === 'active');
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

  // Generic response handler (owner side)
  const handleProposalResponse = async (rentalId, action) => {
    try {
      const rental = rentals.find(r => r.id === rentalId);
      if (!rental) return;

      if (action === 'accept') {
        await Rental.update(rentalId, { status: 'awaiting_driver_confirmation' });
        toast.success('Proposal accepted! Awaiting driver confirmation.');
      } else {
        await Rental.update(rentalId, { status: 'rejected' });
        toast.success('Proposal rejected.');
      }

      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
    } catch (err) {
      toast.error('Failed to update proposal: ' + err.message);
    }
  };

  // Fetch driver details for the driver detail modal (owner side)
  const fetchDriverDetails = async (driverId) => {
    setLoadingDriver(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, location, license_year, license_number, verified, rating')
        .eq('id', driverId)
        .single();

      if (error) throw error;
      setSelectedDriver(data);
      return data;
    } catch (err) {
      toast.error('Could not load driver details');
      console.error(err);
    } finally {
      setLoadingDriver(false);
    }
  };

  // Generate contract text (simplified, but you already have the full version in previous messages)
  const generateContractText = (rental, vehicle, driverProfile) => {
    // ... use the full template from earlier (I'm omitting for brevity, but it's the same as before)
    return `VEHICLE RENTAL CONTRACT
...
Vehicle: ${vehicle?.make} ${vehicle?.model}
...
`;
  };

  const openContractModal = async (rental) => {
    setSelectedProposal(rental);
    setContractAgreed(false);

    const vehicle = vehicles.find(v => v.id === rental.vehicle_id) || allVehicles.find(v => v.id === rental.vehicle_id);
    if (rental.driver_id) {
      const profile = await fetchDriverDetails(rental.driver_id);
      const text = generateContractText(rental, vehicle, profile);
      setSelectedProposal({ ...rental, contractText: text });
    } else {
      const text = generateContractText(rental, vehicle, null);
      setSelectedProposal({ ...rental, contractText: text });
    }
    setContractModal(true);
  };

  const closeContractModal = () => {
    setContractModal(false);
    setSelectedProposal(null);
    setContractAgreed(false);
  };

  const handleAcceptWithContract = async () => {
    if (!contractAgreed || !selectedProposal) return;
    await handleProposalResponse(selectedProposal.id, 'accept');
    closeContractModal();
  };

  // ─────────────── Owner Content ───────────────
  const renderOwnerContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3" ref={ownerVehiclesRef}>My Listed Vehicles</h3>
      {/* vehicles list unchanged */}
      
      <h3 className="text-lg font-semibold mb-3 mt-8" ref={ownerAssignmentsRef}>Active Assignments</h3>
      {/* pending proposals with Accept/Reject buttons and View driver details */}
      {/* active assignments */}

      {/* ... (the rest of owner content is unchanged) */}
    </>
  );

  // ─────────────── Driver Content ───────────────
  const renderDriverContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3" ref={driverAvailableRef}>Available Vehicles</h3>
      {/* available vehicles list unchanged */}

      {/* pending confirmation for driver (awaiting_driver_confirmation) */}
      {/* active rentals for driver */}

      {/* ... (the rest of driver content is unchanged) */}
    </>
  );

  // ─────────────── Stat Cards ───────────────
  const renderStatCards = () => {
    // ... (same as before)
  };

  const renderActionButtons = () => {
    // ... (same as before)
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title={`Welcome${user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}`}
        subtitle="Manage your vehicles and rentals"
      />
      {/* onboarding & subscription prompts unchanged */}
      <WalletCard balance={user?.wallet_balance || 0} />
      {renderStatCards()}
      {renderActionButtons()}

      <div className="mt-8" ref={tabsRef}>
        {/* ... role-based content as before */}
      </div>

      {/* Completed Rentals — leave review */}
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

      {/* Review Modal */}
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

      {/* Driver Detail Modal (unchanged) */}
      {/* Contract Modal (unchanged) */}
    </div>
  );
}
