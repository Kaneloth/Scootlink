import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { auth, Vehicle, Rental, supabase } from '@/api/supabaseData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Plus, Search, MapPin, Bike, Users, Car, Crown, ShieldCheck, AlertTriangle,
  Check, X, User as UserIcon, MessageCircle, Loader2
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

// Skeleton for the stat cards row while user is loading
function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-4 rounded-xl border border-border/50 animate-pulse">
          <div className="h-3 bg-muted rounded w-1/2 mb-3" />
          <div className="h-6 bg-muted rounded w-1/4 mb-1" />
          <div className="h-3 bg-muted rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

// Skeleton for the action buttons while user is loading
function ActionButtonsSkeleton() {
  return (
    <div className="mt-6 space-y-2">
      <div className="h-12 rounded-lg bg-muted animate-pulse" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-10 rounded-lg bg-muted animate-pulse" />
        <div className="h-10 rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [reviewModal, setReviewModal] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [loadingDriverId, setLoadingDriverId] = useState(null); // tracks which card is loading

  // Contract modal states
  const [contractModal, setContractModal] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [contractAgreed, setContractAgreed] = useState(false);
  const [editableContractText, setEditableContractText] = useState('');

  const ownerVehiclesRef = useRef(null);
  const ownerAssignmentsRef = useRef(null);
  const driverAvailableRef = useRef(null);
  const driverActiveRentalsRef = useRef(null);
  const reviewsSectionRef = useRef(null);
  const tabsRef = useRef(null);

  const [bothTab, setBothTab] = useState('owner');

  useEffect(() => {
    auth.me().then(u => {
      setUser(u);
      setBalanceLoading(false);
    }).catch(() => setBalanceLoading(false));
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

  const driverPendingConfRentals = rentals.filter(r => r.driver_id === user?.id && r.status === 'awaiting_driver_confirmation');
  const driverActiveRentals = rentals.filter(r => r.driver_id === user?.id && r.status === 'active');

  const accountType = user?.subscription_plan || 'driver';

  const scrollToSection = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const navigateToBothSection = (tab, ref) => {
    setBothTab(tab);
    setTimeout(() => scrollToSection(ref), 100);
  };

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

  const handleDriverConfirm = async () => {
    if (!selectedProposal) return;
    try {
      const rental = rentals.find(r => r.id === selectedProposal.id);
      if (!rental) return;
      await Rental.update(rental.id, { status: 'active', contract_text: editableContractText });
      await Vehicle.update(rental.vehicle_id, { status: 'rented' });
      toast.success('Rental confirmed! Vehicle assigned.');
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
    } catch (err) {
      toast.error('Confirmation failed: ' + err.message);
    } finally {
      closeContractModal();
    }
  };

  // Pure fetch — returns the profile without touching selectedDriver state.
  // Used by openContractModal so it doesn't accidentally open the driver panel.
  const fetchDriverProfile = async (driverId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, location, license_year, license_number, verified, rating')
        .eq('id', driverId)
        .single();
      if (error) throw error;
      return data;
    } catch {
      return null;
    }
  };

  // Opens the driver details panel. Always opens even if the profile fetch fails —
  // falls back to the rental's driver_email so the owner sees something useful.
  // Uses loadingDriverId (not a boolean) so each card tracks its own loading state.
  const fetchDriverDetails = async (driverId, fallbackEmail = '') => {
    setLoadingDriverId(driverId);
    try {
      const data = await fetchDriverProfile(driverId);
      // If RLS blocks the read or the profile row doesn't exist, show what we know
      setSelectedDriver(data || { id: driverId, email: fallbackEmail, full_name: fallbackEmail || 'Driver' });
    } catch {
      setSelectedDriver({ id: driverId, email: fallbackEmail, full_name: fallbackEmail || 'Driver' });
    } finally {
      setLoadingDriverId(null);
    }
  };

  // Generates only the negotiable clauses (sections 3–9).
  // Sections 1 & 2 (Vehicle Details and Rental Terms) are shown as a locked,
  // read-only header in the modal so neither party can alter the financial terms.
  const generateContractText = (rental, vehicle, driverProfile) => {
    const licenseNumber = driverProfile?.license_number || '';
    return `3. DRIVER REQUIREMENTS

The Driver confirms that:
• They are at least 18 years of age.
• They hold a valid and legal driver's licence.
• They are capable of operating the vehicle safely.

Driver's Licence Number: ${licenseNumber}

For motorcycles or scooters:
• A helmet must be worn at all times.
• Only one rider is permitted unless the vehicle is designed for two riders.


4. USE AND OPERATING CONDITIONS

The Driver agrees to:
• Comply with all traffic laws and regulations.
• Observe all speed limits.
• Not operate the vehicle under the influence of alcohol or drugs.
• Not use the vehicle on restricted roads where prohibited.
• Park only in designated and lawful areas.
• Immediately report any accident, damage, or mechanical issue.
• Not allow any unauthorised person to operate the vehicle.
• Not use the vehicle for illegal purposes.


5. OWNER'S RESPONSIBILITIES

The Owner agrees to:
• Ensure the vehicle is roadworthy and complies with all legal safety requirements.
• Provide necessary safety equipment (e.g., helmet where applicable).
• Maintain valid insurance coverage for the vehicle.
• Ensure the vehicle is fitted with a functional tracking device (where applicable).


6. LIABILITY AND DAMAGES

• The Driver assumes responsibility for the vehicle during the rental period.
• The Driver is liable for:
    – Traffic fines, penalties, and violations;
    – Damage beyond normal wear and tear.
• The Owner shall not be liable for injury, loss, or damage resulting from use of the vehicle, except where required by law.
• Insurance shall cover applicable risks; however, any excess, exclusions, or uncovered costs shall be borne by the Driver.


7. RETURN OF VEHICLE

• The vehicle must be returned on or before the rental end date.
• The vehicle must be returned in the same condition as received, excluding normal wear and tear.
• Late returns may incur additional charges.
• The Owner reserves the right to inspect the vehicle upon return.


8. TERMINATION

8.1 Termination for Breach
Either party may terminate this Agreement immediately by written notice if the other party:
• Breaches any material term; and
• Fails to remedy such breach within a reasonable period (not exceeding 48 hours) after written notice.

8.2 Owner's Right to Terminate
The Owner may terminate immediately and reclaim the vehicle if:
• The vehicle is used illegally or recklessly;
• The Driver commits serious traffic violations;
• There is a risk of damage, loss, or theft;
• The Driver provides false or misleading information.

8.3 Driver's Right to Terminate
The Driver may terminate immediately if:
• The vehicle is not roadworthy or safe;
• The Owner fails to provide valid insurance;
• The vehicle does not match its description;
• The Owner fails to fulfil a material obligation.

8.4 Termination for Convenience (No Breach)
Either party may terminate this Agreement without cause by giving written notice of  hours/days.
• The Driver must return the vehicle by the termination date.

8.5 Financial Consequences of Termination
• The Owner shall refund any unused rental fees on a pro-rata basis.
• The deposit shall be refunded subject to deductions for:
    – Damages;
    – Outstanding fees or penalties;
    – Reasonable early termination costs.
• An early termination fee of  (if applicable) may apply.

8.6 Exceptional Circumstances
Either party may terminate immediately without penalty due to:
• Medical emergencies;
• Safety risks;
• Events beyond reasonable control (force majeure).

8.7 Effects of Termination
• The vehicle must be returned immediately upon termination.
• A joint inspection is recommended upon return.
• Any outstanding liabilities shall remain enforceable after termination.


9. GENERAL TERMS

• This Agreement constitutes the entire agreement between the parties.
• Any amendments must be in writing and agreed to by both parties.
• This Agreement shall be governed by the laws of 

By checking the box and clicking "Accept & Sign Agreement" / "Confirm & Finalize Rental", both parties confirm they have read, understood, and agreed to this Agreement. This constitutes a valid digital signature.`;
  };

  const openContractModal = async (rental, role) => {
    setSelectedProposal(rental);
    setContractAgreed(false);

    // If the rental already has a saved contract draft, load it directly —
    // no need to regenerate, preserving any edits either party made previously.
    if (rental.contract_text) {
      setEditableContractText(rental.contract_text);
      setSelectedProposal({ ...rental, contractText: rental.contract_text });
      setContractModal(true);
      return;
    }

    const vehicle = vehicles.find(v => v.id === rental.vehicle_id) || allVehicles.find(v => v.id === rental.vehicle_id);
    let text;
    if (role === 'owner' && rental.driver_id) {
      const profile = await fetchDriverProfile(rental.driver_id);
      text = generateContractText(rental, vehicle, profile);
    } else if (role === 'driver') {
      const driverProfile = { full_name: user?.full_name, license_number: user?.license_number };
      text = generateContractText(rental, vehicle, driverProfile);
    } else {
      text = generateContractText(rental, vehicle, null);
    }
    setEditableContractText(text);
    setSelectedProposal({ ...rental, contractText: text });
    setContractModal(true);
  };

  const closeContractModal = () => {
    setContractModal(false);
    setSelectedProposal(null);
    setContractAgreed(false);
  };

  const handleAcceptWithContract = async () => {
    if (!contractAgreed || !selectedProposal) return;
    // Save the (possibly edited) contract text to the rental before accepting
    try {
      await Rental.update(selectedProposal.id, { contract_text: editableContractText });
    } catch { /* non-fatal — acceptance still proceeds */ }
    await handleProposalResponse(selectedProposal.id, 'accept');
    closeContractModal();
  };

  // =============== RENDER HELPERS ===============

  const renderOwnerContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3" ref={ownerVehiclesRef}>My Listed Vehicles</h3>
      {vehicles.length > 0 ? (
        <div className="space-y-3">
          {vehicles.map(v => (
            <Link key={v.id} to={`/edit-vehicle?id=${v.id}`}><VehicleCard vehicle={v} /></Link>
          ))}
        </div>
      ) : (
        <EmptyState icon="🚗" title="No vehicles listed" description="Add your first vehicle to start earning"
          action={<Link to="/add-vehicle"><Button size="sm"><Plus className="w-4 h-4 mr-1" />Add Vehicle</Button></Link>} />
      )}

      <h3 className="text-lg font-semibold mb-3 mt-8" ref={ownerAssignmentsRef}>Active Assignments</h3>

      {ownerPendingRentals.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-2">PENDING PROPOSALS</p>
          <div className="space-y-3">
            {ownerPendingRentals.map(r => {
              if (!r || !r.vehicle_id) return null;
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const driverName = r.driver_email || 'Driver';
              return (
                <Card key={r.id} className="p-4 border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                  {/* Vehicle + driver info */}
                  <div className="mb-3">
                    <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                    <p className="text-xs text-muted-foreground">Driver: {driverName}</p>
                    <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                    <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                    {r.message && <p className="text-xs italic mt-1">"{r.message}"</p>}
                  </div>

                  {/* View driver details — full-width, clearly separate from action buttons */}
                  {r.driver_id && (
                    <button
                      onClick={() => fetchDriverDetails(r.driver_id, r.driver_email)}
                      disabled={loadingDriverId === r.driver_id}
                      className="w-full text-xs text-primary border border-primary/30 rounded-lg py-2 mb-3 hover:bg-primary/5 active:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      {loadingDriverId === r.driver_id ? 'Loading…' : '👤 View driver details'}
                    </button>
                  )}

                  {/* Accept / Reject — separated by a visible divider */}
                  <div className="flex gap-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                    <Button size="sm" variant="default" className="flex-1 gap-1" onClick={(e) => { e.stopPropagation(); openContractModal(r, 'owner'); }}>
                      <Check className="w-3.5 h-3.5" /> Accept
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={(e) => { e.stopPropagation(); handleProposalResponse(r.id, 'reject'); }}>
                      <X className="w-3.5 h-3.5" /> Reject
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {user?.subscription_active ? (
        ownerActiveRentals.length > 0 ? (
          <div className="space-y-3">
            {ownerActiveRentals.map(r => {
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const driverName = r.driver_email || 'Driver';
              return <RentalCard key={r.id} rental={r} vehicle={vehicle} counterpartyName={driverName} />;
            })}
          </div>
        ) : (
          <EmptyState icon="📋" title="No active assignments" description="When drivers rent your vehicles, they'll appear here" />
        )
      ) : (
        <Card className="p-4 border border-primary/20 bg-primary/5 flex items-center gap-3">
          <Crown className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1"><p className="text-sm font-medium">Subscribe to manage rental assignments</p><p className="text-xs text-muted-foreground">Plans from R 49/month</p></div>
          <Link to="/subscription"><Button size="sm">Subscribe</Button></Link>
        </Card>
      )}
    </>
  );

  const renderDriverContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3" ref={driverAvailableRef}>Available Vehicles</h3>
      {availableForMe.length > 0 ? (
        <div className="space-y-3">
          {availableForMe.map(v => {
            const isAdminUser = ['kanelothelejane@gmail.com'].includes(user?.email);
            const canRent = isAdminUser || (user?.subscription_active && user?.verified);
            return canRent ? (
              <Link key={v.id} to={`/rental-request?vehicleId=${v.id}`}><VehicleCard vehicle={v} /></Link>
            ) : (
              <div key={v.id} onClick={() => toast.warning('Subscribe and complete verification to rent vehicles')} className="cursor-pointer">
                <VehicleCard vehicle={v} />
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="🔍" title="No available vehicles" description="Check back later for new listings" />
      )}

      {driverPendingConfRentals.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3">Pending Confirmation</h3>
          <div className="space-y-3">
            {driverPendingConfRentals.map(r => {
              const vehicle = allVehicles.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id);
              const ownerName = r.owner_email || 'Owner';
              return (
                <Card key={r.id} className="p-4 border border-primary/30 bg-primary/5">
                  <div className="flex flex-col sm:flex-row justify-between gap-3">
                    <div>
                      <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                      <p className="text-xs text-muted-foreground">Owner: {ownerName}</p>
                      <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                      <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                    </div>
                    <div>
                      <Button size="sm" className="gap-1" onClick={() => openContractModal(r, 'driver')}>
                        <Check className="w-3.5 h-3.5" /> Review & Confirm
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <h3 className="text-lg font-semibold mb-3 mt-8" ref={driverActiveRentalsRef}>My Active Rentals</h3>
      {driverActiveRentals.length > 0 ? (
        <div className="space-y-3">
          {driverActiveRentals.map(r => {
            const vehicle = allVehicles.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id);
            const ownerName = r.owner_email || 'Owner';
            return <RentalCard key={r.id} rental={r} vehicle={vehicle} counterpartyName={ownerName} />;
          })}
        </div>
      ) : (
        <EmptyState icon="📋" title="No active rentals" description="You haven't rented any vehicles yet" />
      )}
    </>
  );

  const renderStatCards = () => {
    // Show skeleton while user hasn't loaded yet
    if (!user) return <StatCardsSkeleton />;

    if (accountType === 'driver') {
      return (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
          <div onClick={() => scrollToSection(driverAvailableRef)} className="cursor-pointer"><StatCard icon={Search} label="Available Vehicles" value={availableForMe.length} subtitle="Vehicles near you" /></div>
          <div onClick={() => scrollToSection(driverActiveRentalsRef)} className="cursor-pointer"><StatCard icon={Bike} label="Active Rentals" value={driverActiveRentals.length} /></div>
          <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer"><StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} /></div>
        </div>
      );
    }
    if (accountType === 'both') {
      return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
          <div onClick={() => navigateToBothSection('owner', ownerVehiclesRef)} className="cursor-pointer"><StatCard icon={Car} label="My Vehicles" value={vehicles.length} /></div>
          <div onClick={() => navigateToBothSection('driver', driverAvailableRef)} className="cursor-pointer"><StatCard icon={Search} label="Available" value={availableForMe.length} subtitle="Vehicles near you" /></div>
          <div onClick={() => navigateToBothSection('owner', ownerAssignmentsRef)} className="cursor-pointer"><StatCard icon={Bike} label="Active Rentals" value={ownerActiveRentals.length} /></div>
          <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer"><StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} /></div>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        <div onClick={() => scrollToSection(ownerVehiclesRef)} className="cursor-pointer"><StatCard icon={Car} label="My Vehicles" value={vehicles.length} /></div>
        <div onClick={() => scrollToSection(ownerAssignmentsRef)} className="cursor-pointer"><StatCard icon={Bike} label="Active Rentals" value={ownerActiveRentals.length} /></div>
        <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer"><StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} /></div>
      </div>
    );
  };

  const renderActionButtons = () => {
    // Show skeleton while user hasn't loaded yet
    if (!user) return <ActionButtonsSkeleton />;

    const rowButtonClass = "w-full gap-1.5 py-3 text-xs lg:text-sm";
    const iconClass = "w-4 h-4";
    if (accountType === 'owner' || accountType === 'both') {
      const gridCols = accountType === 'both' ? 'grid-cols-3' : 'grid-cols-2';
      return (
        <div className="mt-6">
          <Link to="/add-vehicle" className="block w-full mb-2">
            <Button className="w-full gap-2 py-5 text-base"><Plus className={iconClass} /> Add Vehicle</Button>
          </Link>
          <div className={`grid gap-2 ${gridCols}`}>
            <Link to="/find-drivers"><Button variant="outline" className={rowButtonClass}><Users className={iconClass} /> Find Drivers</Button></Link>
            {accountType === 'both' && <Link to="/search-vehicles"><Button variant="outline" className={rowButtonClass}><Search className={iconClass} /> Find Vehicles</Button></Link>}
            <Link to="/tracking"><Button variant="outline" className={rowButtonClass}><MapPin className={iconClass} /> GPS Track</Button></Link>
          </div>
        </div>
      );
    }
    if (accountType === 'driver') {
      return (
        <div className="grid grid-cols-2 gap-2 mt-6">
          <Link to="/search-vehicles"><Button className="w-full gap-2 py-4 text-sm"><Search className="w-4 h-4" /> Find Vehicles</Button></Link>
          <Link to="/tracking"><Button variant="outline" className="w-full gap-2 py-4 text-sm"><MapPin className="w-4 h-4" /> GPS Track</Button></Link>
        </div>
      );
    }
    return null;
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader title={`Welcome${user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}`} subtitle="Manage your vehicles and rentals" />

      {user && !user.onboarding_completed && (
        <Card className="p-4 border-2 border-amber-300 bg-amber-50 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div><p className="text-sm font-semibold text-amber-800">Complete your profile to get started</p><p className="text-xs text-amber-700">Identity verification required before using Scootlink</p></div>
          </div>
          <Link to="/onboarding"><Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600">Set Up</Button></Link>
        </Card>
      )}

      {user && user.onboarding_completed && !user.subscription_active && (
        <Card className="p-4 border-2 border-primary/30 bg-primary/5 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Crown className="w-5 h-5 text-primary shrink-0" />
            <div><p className="text-sm font-semibold text-foreground">Subscribe to unlock full access</p><p className="text-xs text-muted-foreground">Plans from R 49/month</p></div>
          </div>
          <Link to="/subscription"><Button size="sm" className="shrink-0">Subscribe</Button></Link>
        </Card>
      )}

      <Link to="/wallet">
        <WalletCard balance={user?.wallet_balance ?? 0} loading={balanceLoading} />
      </Link>

      {renderStatCards()}
      {renderActionButtons()}

      <div className="mt-8" ref={tabsRef}>
        {/* Don't render tabs until user is loaded — avoids flashing wrong tab content */}
        {!user ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl border border-border/50 bg-muted animate-pulse" />
            ))}
          </div>
        ) : accountType === 'both' ? (
          <Tabs value={bothTab} onValueChange={setBothTab}>
            <TabsList className="grid w-full grid-cols-2 max-w-xs"><TabsTrigger value="owner">Owner</TabsTrigger><TabsTrigger value="driver">Driver</TabsTrigger></TabsList>
            <TabsContent value="owner" className="mt-4">{renderOwnerContent()}</TabsContent>
            <TabsContent value="driver" className="mt-4">{renderDriverContent()}</TabsContent>
          </Tabs>
        ) : accountType === 'owner' ? (
          <div>{renderOwnerContent()}</div>
        ) : (
          <div>{renderDriverContent()}</div>
        )}
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
              const targetId = isOwner ? r.driver_id : r.owner_id;
              const v = [...vehicles, ...allVehicles].find(v => v.id === r.vehicle_id);
              return (
                <Card key={r.id} className="p-4 border border-border/50 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{v ? `${v.make} ${v.model}` : 'Rental'}</p>
                    <p className="text-xs text-muted-foreground">{isOwner ? 'Driver: ' : 'Owner: '}{targetEmail}</p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 shrink-0"
                    onClick={() => {
                      setReviewModal({
                        rental: r,
                        targetEmail,
                        targetName: targetEmail,
                        targetType,
                        targetId
                      });
                    }}>
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

      {/* Driver Detail Modal — rendered via portal so the AppLayout transform/overflow
          never clips or repositions it. Portals attach directly to document.body. */}
      {selectedDriver && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40" onClick={() => setSelectedDriver(null)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 border border-border" onClick={e => e.stopPropagation()}>
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
              {selectedDriver.phone && <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="font-medium">{selectedDriver.phone}</span></div>}
              {selectedDriver.location && <div className="flex justify-between"><span className="text-muted-foreground">Location</span><span className="font-medium">{selectedDriver.location}</span></div>}
              {selectedDriver.license_year && <div className="flex justify-between"><span className="text-muted-foreground">Experience</span><span className="font-medium">{currentYear - selectedDriver.license_year} years</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Verified</span><span>{selectedDriver.verified ? '✅ Verified' : '⏳ Pending'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rating</span><span><StarRating value={Math.round(selectedDriver.rating || 0)} size="sm" showValue /></span></div>
            </div>
            <Button
              className="w-full mt-6 gap-2"
              onClick={() => {
                const canMsg = ['kanelothelejane@gmail.com'].includes(user?.email) || (user?.subscription_active && user?.verified);
                if (!canMsg) {
                  toast.warning(
                    !user?.subscription_active
                      ? 'You need an active subscription to message drivers'
                      : 'Your account is awaiting verification'
                  );
                  return;
                }
                setSelectedDriver(null);
                navigate(`/messages?userId=${selectedDriver.id}`);
              }}
            >
              <MessageCircle className="w-4 h-4" /> Message {selectedDriver.full_name?.split(' ')[0]}
            </Button>
          </div>
        </div>,
        document.body
      )}

      {/* Contract Modal — portal so AppLayout transform/overflow can't clip it */}
      {contractModal && selectedProposal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40" onClick={closeContractModal}>
          <div className="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-6 border border-border flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="text-xl font-bold">Rental Agreement</h2>
              <button onClick={closeContractModal} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            {/* Locked financial terms — sourced directly from the database record.
                Neither party can edit these; they reflect exactly what was proposed. */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-3 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Binding Terms — cannot be edited</p>
              </div>
              {(() => {
                const v = vehicles.find(x => x.id === selectedProposal.vehicle_id) || allVehicles.find(x => x.id === selectedProposal.vehicle_id);
                return (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                    <span className="text-muted-foreground">Vehicle:</span>
                    <span className="font-medium">{v ? `${v.make} ${v.model} (${v.year || ''})` : `#${selectedProposal.vehicle_id}`}</span>
                    <span className="text-muted-foreground">Start date:</span>
                    <span className="font-medium">{selectedProposal.start_date}</span>
                    <span className="text-muted-foreground">End date:</span>
                    <span className="font-medium">{selectedProposal.end_date}</span>
                    <span className="text-muted-foreground">Weekly rate:</span>
                    <span className="font-medium">R {selectedProposal.price_per_week}</span>
                    <span className="text-muted-foreground">Security deposit:</span>
                    <span className="font-medium">R {selectedProposal.deposit}</span>
                  </div>
                );
              })()}
            </div>

            {/* Clauses — owner can edit freely; driver is read-only */}
            <p className="text-xs text-muted-foreground mb-2 shrink-0">
              {selectedProposal.driver_id === user?.id
                ? 'Review the terms below. If you want changes, request them via Messages — only the owner can edit the contract.'
                : 'Edit the clauses below as needed. The driver will review and either confirm or request changes via Messages.'}
            </p>
            <div className="bg-muted rounded-xl p-3 flex-1 overflow-y-auto mb-4 min-h-0">
              <textarea
                className="w-full h-full min-h-[30vh] bg-transparent text-sm font-mono resize-none outline-none leading-relaxed disabled:cursor-default"
                value={editableContractText}
                onChange={e => setEditableContractText(e.target.value)}
                readOnly={selectedProposal.driver_id === user?.id}
              />
            </div>

            <div className="flex items-start gap-3 mb-4 shrink-0">
              <input type="checkbox" id="agree-contract" checked={contractAgreed} onChange={e => setContractAgreed(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <label htmlFor="agree-contract" className="text-sm text-muted-foreground">
                I confirm I have read, understood, and agree to be bound by this Rental Agreement and all its terms.
              </label>
            </div>
            <div className="flex gap-3 shrink-0">
              <Button variant="outline" className="flex-1" onClick={closeContractModal}>Cancel</Button>
              <Button className="flex-1" disabled={!contractAgreed}
                onClick={() => {
                  if (selectedProposal.driver_id === user?.id) handleDriverConfirm();
                  else handleAcceptWithContract();
                }}>
                {selectedProposal.driver_id === user?.id ? 'Confirm & Finalize Rental' : 'Accept & Sign Agreement'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
