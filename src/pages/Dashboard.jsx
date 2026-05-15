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
  Check, X, User as UserIcon, MessageCircle, Loader2, StopCircle
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

// ─── Profile Detail Panel ─────────────────────────────────────────────────────
// Standalone component so it can be used as a direct child of createPortal
// without the broken .map() pattern.
function ProfileDetailPanel({ profile, role, currentYear, onClose, onMessage, canMessage, onMessageBlocked }) {
  const row = (label, value, extra = {}) => value ? (
    <div className={`flex justify-between px-4 py-2.5 ${extra.wrap ? 'gap-4' : ''}`}>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`font-medium ${extra.right ? 'text-right' : ''} ${extra.mono ? 'font-mono tracking-wide' : ''}`}>{value}</span>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-xl max-w-md w-full border border-border flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-xl font-bold">{role} Profile</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 pb-6 flex-1">

          {/* Avatar + name + verified badge */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary overflow-hidden shrink-0">
              {profile.avatar_visible !== false && profile.avatar_url
                ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                : (profile.full_name?.[0]?.toUpperCase() || '?')}
            </div>
            <div>
              <p className="font-semibold text-lg leading-tight">{profile.full_name || role}</p>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
              <p className="text-xs mt-1">
                {profile.verified
                  ? <span className="text-green-600 font-medium">✅ Verified</span>
                  : <span className="text-amber-600 font-medium">⏳ Pending verification</span>}
              </p>
            </div>
          </div>

          {/* Detail rows — only renders rows that have data */}
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden text-sm mb-5">
            {row('Phone',        profile.phone)}
            {row('Gender',       profile.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : null)}
            {row('Citizenship',  profile.citizenship)}
            {row('City / Area',  profile.location)}
            {row('Address',      profile.residential_address, { wrap: true, right: true })}
            {row('Licence No.',  profile.license_number, { mono: true })}
            {profile.license_year && (
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-muted-foreground">Licence Since</span>
                <span className="font-medium">
                  {profile.license_year} ({currentYear - profile.license_year} yr{currentYear - profile.license_year !== 1 ? 's' : ''} experience)
                </span>
              </div>
            )}
            <div className="flex justify-between px-4 py-2.5">
              <span className="text-muted-foreground">Rating</span>
              <span><StarRating value={Math.round(profile.rating || 0)} size="sm" showValue /></span>
            </div>
          </div>

          {/* Message button */}
          <Button
            className="w-full gap-2"
            onClick={() => {
              if (!canMessage) { onMessageBlocked(); return; }
              onMessage(profile.id);
            }}
          >
            <MessageCircle className="w-4 h-4" /> Message {profile.full_name?.split(' ')[0] || role}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [reviewModal, setReviewModal] = useState(null);
  const [selectedDriver,  setSelectedDriver]  = useState(null);
  const [loadingDriverId, setLoadingDriverId] = useState(null);
  const [selectedOwner,   setSelectedOwner]   = useState(null);
  const [loadingOwnerId,  setLoadingOwnerId]  = useState(null);
  const [endingRentalId,  setEndingRentalId]  = useState(null);

  // Contract modal states
  const [contractModal, setContractModal] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [contractAgreed, setContractAgreed] = useState(false);
  const [editableContractText, setEditableContractText] = useState('');
  // 'accept' = owner signing a fresh proposal
  // 'edit'   = owner updating an already-accepted contract
  // 'review' = driver reading and confirming
  const [contractEditMode, setContractEditMode] = useState('accept');

  const ownerVehiclesRef = useRef(null);
  const ownerAssignmentsRef = useRef(null);
  const driverAvailableRef = useRef(null);
  const driverActiveRentalsRef = useRef(null);
  const reviewsSectionRef = useRef(null);
  const tabsRef = useRef(null);

  const [bothTab, setBothTab] = useState('owner');

  // Counterparty names cache: { [userId]: displayName }
  const [counterpartyNames, setCounterpartyNames] = useState({});

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

  // All vehicles regardless of status — used to look up vehicle details on active/completed rental cards
  const { data: allVehiclesLookup = [] } = useQuery({
    queryKey: ['all-vehicles-lookup'],
    queryFn: async () => {
      const { data } = await supabase.from('vehicles').select('*');
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: rentals = [] } = useQuery({
    queryKey: ['my-rentals'],
    queryFn: async () => {
      const all = await Rental.list();
      return all.filter(r => r.owner_id === user?.id || r.driver_id === user?.id);
    },
    enabled: !!user?.id,
  });

  // ── Fetch profiles via Netlify function (uses service role, bypasses RLS) ──
  // Falls back to a direct Supabase query if the function isn't available.
  const fetchProfilesViaFunction = async (ids) => {
    if (!ids || ids.length === 0) return [];
    try {
      const res = await fetch('/.netlify/functions/get-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) return await res.json();
    } catch { /* fall through to direct query */ }
    // Fallback: direct Supabase query using only columns confirmed to exist.
    // Including unknown columns (avatar_url, etc.) silently kills the entire query.
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, location, license_year, license_number, verified, rating')
      .in('id', ids);
    return data || [];
  };

  // Populate the counterpartyNames cache whenever rentals change
  useEffect(() => {
    if (!user || rentals.length === 0) return;
    const idsToFetch = new Set();
    rentals.forEach(r => {
      if (r.owner_id === user.id && r.driver_id) idsToFetch.add(r.driver_id);
      if (r.driver_id === user.id && r.owner_id) idsToFetch.add(r.owner_id);
    });
    const idsArray = Array.from(idsToFetch);
    if (idsArray.length === 0) return;

    fetchProfilesViaFunction(idsArray).then(profiles => {
      const nameMap = {};
      profiles.forEach(p => {
        nameMap[p.id] = p.full_name || p.email || '';
      });
      setCounterpartyNames(prev => ({ ...prev, ...nameMap }));
    });
  }, [rentals, user]);

  const getCounterpartyName = (id) => counterpartyNames[id] || '';

  const availableForMe = allVehicles.filter(v => v.owner_id !== user?.id);
  const completedRentals = rentals.filter(r => r.status === 'completed');

  const ownerRentals = rentals.filter(r => r.owner_id === user?.id);
  const ownerPendingRentals = ownerRentals.filter(r => r.status === 'pending');
  const ownerAwaitingRentals = ownerRentals.filter(r => r.status === 'awaiting_driver_confirmation');
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

  // Tries to update a rental with optional extra fields; if Supabase rejects because
  // a column doesn't exist yet, retries with just the required fields.
  const safeRentalUpdate = async (id, required, optional = {}) => {
    try {
      await Rental.update(id, { ...required, ...optional });
    } catch (err) {
      const msg = err?.message || '';
      const missingCol = Object.keys(optional).some(k =>
        msg.toLowerCase().includes(k.toLowerCase())
      );
      if (missingCol) {
        await Rental.update(id, required);
      } else {
        throw err;
      }
    }
  };

  const handleDriverConfirm = async () => {
    if (!selectedProposal) return;
    try {
      const rental = rentals.find(r => r.id === selectedProposal.id);
      if (!rental) return;
      await safeRentalUpdate(
        rental.id,
        { status: 'active', contract_text: editableContractText },
        { confirmed_at: new Date().toISOString() }
      );
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

  const handleEndRental = async (rental) => {
    if (!window.confirm('End this rental? The vehicle will be marked available again and the rental will move to Completed.')) return;
    setEndingRentalId(rental.id);
    try {
      await safeRentalUpdate(
        rental.id,
        { status: 'completed' },
        { ended_at: new Date().toISOString() }
      );
      await Vehicle.update(rental.vehicle_id, { status: 'available' });
      toast.success('Rental ended. You can now leave a review.');
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
    } catch (err) {
      toast.error('Could not end rental: ' + err.message);
    } finally {
      setEndingRentalId(null);
    }
  };

  // Format a commencement date — use confirmed_at if saved, fall back to start_date, then today
  const formatCommenced = (r) => {
    const raw = r.confirmed_at || r.start_date;
    if (!raw) return 'Date not recorded';
    try {
      return new Date(raw).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return raw; }
  };

  // Columns confirmed to exist in the profiles table
  const PROFILE_SELECT_SAFE = 'id, full_name, email, phone, location, license_year, license_number, verified, rating';
  // Columns that may not exist yet (not yet migrated) — fetched separately so any
  // missing column never breaks the safe fetch above
  const PROFILE_SELECT_EXTRA = 'id, residential_address, gender, citizenship, avatar_url, avatar_visible';

  // Fetches a full profile — uses the Netlify function (service role, bypasses RLS)
  // and falls back to a two-step direct Supabase query so missing columns never
  // break the safe fields.
  const fetchFullProfile = async (userId) => {
    const profiles = await fetchProfilesViaFunction([userId]);
    if (profiles.length > 0) return profiles[0];
    // Fallback: split query so unknown columns don't kill confirmed ones
    const [safeResult, extraResult] = await Promise.all([
      supabase.from('profiles').select(PROFILE_SELECT_SAFE).eq('id', userId).single(),
      supabase.from('profiles').select(PROFILE_SELECT_EXTRA).eq('id', userId).single(),
    ]);
    const base  = safeResult.data  || null;
    const extra = extraResult.error ? {} : (extraResult.data || {});
    return base ? { ...base, ...extra } : null;
  };

  // Pure fetch — used by openContractModal (doesn't open the driver panel).
  const fetchDriverProfile = async (driverId) => {
    try { return await fetchFullProfile(driverId); }
    catch { return null; }
  };

  // Opens the driver details panel.
  const fetchDriverDetails = async (driverId, fallbackEmail = '') => {
    setLoadingDriverId(driverId);
    try {
      const data = await fetchFullProfile(driverId);
      setSelectedDriver(data || { id: driverId, email: fallbackEmail, full_name: fallbackEmail || 'Driver' });
    } catch {
      setSelectedDriver({ id: driverId, email: fallbackEmail, full_name: fallbackEmail || 'Driver' });
    } finally {
      setLoadingDriverId(null);
    }
  };

  // Opens the owner details panel for the driver's view.
  const fetchOwnerDetails = async (ownerId, fallbackEmail = '') => {
    setLoadingOwnerId(ownerId);
    try {
      const data = await fetchFullProfile(ownerId);
      setSelectedOwner(data || { id: ownerId, email: fallbackEmail, full_name: fallbackEmail || 'Owner' });
    } catch {
      setSelectedOwner({ id: ownerId, email: fallbackEmail, full_name: fallbackEmail || 'Owner' });
    } finally {
      setLoadingOwnerId(null);
    }
  };

  // Generates the full contract (all 9 sections).
  // Owner can edit everything freely; driver sees it read-only and confirms when satisfied.
  const generateContractText = (rental, vehicle, driverProfile) => {
    const today = new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
    const ownerName = user?.full_name || '';
    const ownerIdNo = user?.id_number || user?.passport_number || '';
    const driverName = driverProfile?.full_name || '';
    const driverIdNo = driverProfile?.id_number || driverProfile?.passport_number || '';
    const licenseNumber = driverProfile?.license_number || '';
    const vType = vehicle?.vehicle_type || vehicle?.type || '';
    const vMake = vehicle?.make || '';
    const vModel = vehicle?.model || '';
    const vYear = vehicle?.year || '';
    return `VEHICLE RENTAL AGREEMENT

This Vehicle Rental Agreement ("Agreement") is entered into on ${today} (Effective Date),

BETWEEN:

Owner: ${ownerName}
ID/Passport No: ${ownerIdNo}

AND

Driver (Renter): ${driverName}
ID/Passport No: ${driverIdNo}


1. VEHICLE DETAILS

Type: ${vType}
Make: ${vMake}
Model: ${vModel}
Year: ${vYear}
Current Odometer Reading: 


2. RENTAL TERMS

Rental Start Date: ${rental.start_date || ''}
Rental End Date: ${rental.end_date || ''}
Weekly Rate: R ${rental.price_per_week || ''}
Security Deposit: R ${rental.deposit || ''}

The security deposit shall be refundable upon return of the vehicle, subject to inspection.
Any damages, fines, or additional charges will be deducted from the deposit.


3. DRIVER REQUIREMENTS

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

  // mode: 'accept' (owner, fresh proposal) | 'edit' (owner, already accepted) | 'review' (driver)
  const openContractModal = async (rental, mode) => {
    setSelectedProposal(rental);
    setContractAgreed(false);
    setContractEditMode(mode);

    const vehicle = vehicles.find(v => v.id === rental.vehicle_id) || allVehicles.find(v => v.id === rental.vehicle_id);

    // Always fetch driver profile so names/IDs populate correctly for both parties
    let driverProfileData = null;
    if (rental.driver_id) {
      driverProfileData = await fetchDriverProfile(rental.driver_id);
    }
    // If we're the driver opening our own review, use our own profile
    if (!driverProfileData && mode === 'review') {
      driverProfileData = {
        full_name: user?.full_name,
        id_number: user?.id_number,
        passport_number: user?.passport_number,
        license_number: user?.license_number,
      };
    }

    // Use saved contract_text only when it is a complete contract (contains the header).
    // Old saves only stored clauses 3–9 and lack the header — regenerate those from scratch.
    const isComplete = rental.contract_text && rental.contract_text.trimStart().startsWith('VEHICLE RENTAL AGREEMENT');
    const text = isComplete ? rental.contract_text : generateContractText(rental, vehicle, driverProfileData);

    setEditableContractText(text);
    setSelectedProposal({ ...rental, contractText: text });
    setContractModal(true);
  };

  const closeContractModal = () => {
    setContractModal(false);
    setSelectedProposal(null);
    setContractAgreed(false);
  };

  // Owner withdraws the contract they sent — cancelled removes it from both views
  const handleWithdrawContract = async (rental) => {
    if (!window.confirm('Withdraw this contract? It will be removed from both your dashboard and the driver\'s. You can send a new proposal at any time.')) return;
    try {
      await Rental.update(rental.id, { status: 'cancelled', contract_text: null });
      toast.success('Contract withdrawn and removed from both dashboards.');
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
    } catch (err) {
      toast.error(`Could not withdraw contract: ${err?.message || 'please try again.'}`);
    }
  };

  // Driver rejects a contract — cancelled removes it from both views
  const handleRejectContract = async (rental) => {
    if (!window.confirm('Reject this contract? It will be removed from both your dashboard and the owner\'s. Message the owner if you want to renegotiate.')) return;
    try {
      await Rental.update(rental.id, { status: 'cancelled' });
      toast.success('Contract rejected and removed from both dashboards. Use Messages to renegotiate.');
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
    } catch (err) {
      toast.error(`Could not reject contract: ${err?.message || 'please try again.'}`);
    }
  };

  // Owner saves edits to an already-accepted contract without changing its status
  const handleSaveContractEdits = async () => {
    if (!selectedProposal) return;
    try {
      await Rental.update(selectedProposal.id, { contract_text: editableContractText });
      toast.success('Contract updated. Driver will see the new version.');
      closeContractModal();
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    }
  };

  const handleAcceptWithContract = async () => {
    if (!contractAgreed || !selectedProposal) return;
    try {
      await Rental.update(selectedProposal.id, { contract_text: editableContractText });
    } catch { /* non-fatal */ }
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
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehiclesLookup.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const driverName = getCounterpartyName(r.driver_id) || r.driver_email || 'Driver';
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
                    <Button size="sm" variant="default" className="flex-1 gap-1" onClick={(e) => { e.stopPropagation(); openContractModal(r, 'accept'); }}>
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

      {ownerAwaitingRentals.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-2">AWAITING DRIVER CONFIRMATION</p>
          <div className="space-y-3">
            {ownerAwaitingRentals.map(r => {
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehiclesLookup.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              return (
                <Card key={r.id} className="p-4 border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
                  <div className="mb-3">
                    <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                    <p className="text-xs text-muted-foreground">Driver: {r.driver_email || 'Driver'}</p>
                    <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                    <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                    Contract sent — waiting for driver to confirm. Edit if changes were agreed via Messages, or withdraw to cancel.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => openContractModal(r, 'edit')}>
                      ✏️ Edit Contract
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => handleWithdrawContract(r)}>
                      ✕ Withdraw
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
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehiclesLookup.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const driverName = getCounterpartyName(r.driver_id) || r.driver_email || 'Driver';
              const isEnding = endingRentalId === r.id;
              return (
                <Card key={r.id} className="p-4 border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800">
                  <div className="mb-3">
                    <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                    <p className="text-xs text-muted-foreground">Driver: {driverName}</p>
                    <p className="text-xs text-muted-foreground">Started: {formatCommenced(r)}</p>
                    <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                  </div>
                  {r.driver_id && (
                    <button
                      onClick={() => fetchDriverDetails(r.driver_id, r.driver_email)}
                      disabled={loadingDriverId === r.driver_id}
                      className="w-full text-xs text-primary border border-primary/30 rounded-lg py-2 mb-3 hover:bg-primary/5 active:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      {loadingDriverId === r.driver_id ? 'Loading…' : '👤 View driver details'}
                    </button>
                  )}
                  <div className="flex gap-2 pt-2 border-t border-green-200 dark:border-green-800">
                    {r.driver_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
                        onClick={() => navigate(`/messages?userId=${r.driver_id}`)}
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Message Driver
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                      disabled={isEnding}
                      onClick={() => handleEndRental(r)}
                    >
                      {isEnding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />}
                      {isEnding ? 'Ending…' : 'End Rental'}
                    </Button>
                  </div>
                </Card>
              );
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
              const vehicle = allVehiclesLookup.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const ownerName = getCounterpartyName(r.owner_id) || r.owner_email || 'Owner';
              return (
                <Card key={r.id} className="p-4 border border-primary/30 bg-primary/5">
                  <div className="flex flex-col sm:flex-row justify-between gap-3">
                    <div>
                      <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                      <p className="text-xs text-muted-foreground">Owner: {ownerName}</p>
                      <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                      <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button size="sm" className="gap-1" onClick={() => openContractModal(r, 'review')}>
                        <Check className="w-3.5 h-3.5" /> Review & Confirm
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => handleRejectContract(r)}>
                        ✕ Reject Contract
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
            const vehicle = allVehiclesLookup.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
            const ownerName = getCounterpartyName(r.owner_id) || r.owner_email || 'Owner';
            const isEnding = endingRentalId === r.id;
            return (
              <Card key={r.id} className="p-4 border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800">
                <div className="mb-3">
                  <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                  <p className="text-xs text-muted-foreground">Owner: {ownerName}</p>
                  <p className="text-xs text-muted-foreground">Started: {formatCommenced(r)}</p>
                  <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                </div>
                {r.owner_id && (
                  <button
                    onClick={() => fetchOwnerDetails(r.owner_id, r.owner_email)}
                    disabled={loadingOwnerId === r.owner_id}
                    className="w-full text-xs text-primary border border-primary/30 rounded-lg py-2 mb-3 hover:bg-primary/5 active:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    {loadingOwnerId === r.owner_id ? 'Loading…' : '👤 View owner details'}
                  </button>
                )}
                <div className="flex gap-2 pt-2 border-t border-green-200 dark:border-green-800">
                  {r.owner_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
                      onClick={() => navigate(`/messages?userId=${r.owner_id}`)}
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> Message Owner
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                    disabled={isEnding}
                    onClick={() => handleEndRental(r)}
                  >
                    {isEnding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" />}
                    {isEnding ? 'Ending…' : 'End Rental'}
                  </Button>
                </div>
              </Card>
            );
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
            <div><p className="text-sm font-semibold text-amber-800">Complete your profile to get started</p><p className="text-xs text-amber-700">Identity verification required before using Skootlink</p></div>
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
              const v = allVehiclesLookup.find(veh => veh.id === r.vehicle_id) || vehicles.find(veh => veh.id === r.vehicle_id) || allVehicles.find(veh => veh.id === r.vehicle_id);
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

      {/* Driver & Owner profile detail panels — two explicit portals (never use .map for portals) */}
      {selectedDriver && createPortal(
        <ProfileDetailPanel
          profile={selectedDriver}
          role="Driver"
          currentYear={currentYear}
          onClose={() => setSelectedDriver(null)}
          onMessage={(id) => { setSelectedDriver(null); navigate(`/messages?userId=${id}`); }}
          canMessage={['kanelothelejane@gmail.com'].includes(user?.email) || (user?.subscription_active && user?.verified)}
          onMessageBlocked={() => toast.warning(!user?.subscription_active ? 'You need an active subscription to message drivers' : 'Your account is awaiting verification')}
        />,
        document.body
      )}
      {selectedOwner && createPortal(
        <ProfileDetailPanel
          profile={selectedOwner}
          role="Owner"
          currentYear={currentYear}
          onClose={() => setSelectedOwner(null)}
          onMessage={(id) => { setSelectedOwner(null); navigate(`/messages?userId=${id}`); }}
          canMessage={['kanelothelejane@gmail.com'].includes(user?.email) || (user?.subscription_active && user?.verified)}
          onMessageBlocked={() => toast.warning(!user?.subscription_active ? 'You need an active subscription to message owners' : 'Your account is awaiting verification')}
        />,
        document.body
      )}

      {/* Contract Modal — portal so AppLayout transform/overflow can't clip it */}
      {contractModal && selectedProposal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40" onClick={closeContractModal}>
          <div className="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-6 border border-border flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1 shrink-0">
              <h2 className="text-xl font-bold">Rental Agreement</h2>
              <button onClick={closeContractModal} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            <p className="text-xs text-muted-foreground mb-3 shrink-0">
              {contractEditMode === 'review'
                ? 'Read the full agreement below. If you want any changes, request them via Messages — the owner will update the contract. Confirm only when you are fully satisfied.'
                : contractEditMode === 'edit'
                  ? 'Edit the contract below to reflect any changes agreed via Messages, then save. The driver will see the updated version.'
                  : 'Review and edit all details below before sending to the driver. Once you accept, the driver will confirm to finalise the rental.'}
            </p>

            {/* Full contract textarea — editable for owner (accept/edit modes), read-only for driver (review) */}
            <div className="bg-muted rounded-xl p-3 flex-1 overflow-y-auto mb-4 min-h-0">
              <textarea
                className="w-full h-full min-h-[40vh] bg-transparent text-sm font-mono resize-none outline-none leading-relaxed"
                value={editableContractText}
                onChange={e => setEditableContractText(e.target.value)}
                readOnly={contractEditMode === 'review'}
              />
            </div>

            {/* Checkbox only shown for accept and review (actual signing steps) */}
            {contractEditMode !== 'edit' && (
              <div className="flex items-start gap-3 mb-4 shrink-0">
                <input type="checkbox" id="agree-contract" checked={contractAgreed} onChange={e => setContractAgreed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
                <label htmlFor="agree-contract" className="text-sm text-muted-foreground">
                  I confirm I have read, understood, and agree to be bound by this Rental Agreement and all its terms.
                </label>
              </div>
            )}

            <div className="flex gap-3 shrink-0">
              <Button variant="outline" className="flex-1" onClick={closeContractModal}>Cancel</Button>

              {contractEditMode === 'accept' && (
                <Button className="flex-1" disabled={!contractAgreed} onClick={handleAcceptWithContract}>
                  Accept & Send to Driver
                </Button>
              )}
              {contractEditMode === 'edit' && (
                <Button className="flex-1" onClick={handleSaveContractEdits}>
                  Save Contract Changes
                </Button>
              )}
              {contractEditMode === 'review' && (
                <Button className="flex-1" disabled={!contractAgreed} onClick={handleDriverConfirm}>
                  Confirm & Finalise Rental
                </Button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
