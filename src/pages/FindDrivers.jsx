import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase, Vehicle } from '@/api/supabaseData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import StarRating from '@/components/reviews/StarRating';
import ContractSectionsList from '@/components/contract/ContractSectionsList';
import { generateContractSections, flattenContractSections, mergeDriverIntoDraft } from '@/lib/contractSections';
import { notify } from '@/lib/notify';
import {
  Search, User, X, MessageCircle, Loader2, ShieldCheck, Star, MapPin,
  SlidersHorizontal, Check, FileText,
} from 'lucide-react';
import { toast } from 'sonner';

const RADIUS_OPTIONS = [10, 20, 50, 100];

export default function FindDrivers() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [minExperience, setMinExperience] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [radiusKm, setRadiusKm] = useState(50);
  const [showFilters, setShowFilters] = useState(false);

  const [selectedDriver, setSelectedDriver] = useState(null);
  const [ownerVehicles, setOwnerVehicles] = useState([]);
  const [contractModal, setContractModal] = useState(false);
  const [contractVehicle, setContractVehicle] = useState(null);
  const [contractSections, setContractSections] = useState([]);
  const [sendingContract, setSendingContract] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return;
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
        setUser(profile);

        const vehicles = await Vehicle.filter({ owner_id: authUser.id });
        setOwnerVehicles(vehicles || []);

        const { data: allDrivers } = await supabase
          .from('profiles')
          .select('*')
          .in('account_type', ['driver', 'both']);
        setDrivers(allDrivers || []);
      } catch (err) {
        console.error('[FindDrivers] Load failed:', err);
        toast.error('Could not load drivers.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredDrivers = useMemo(() => {
    return drivers.filter(d => {
      if (d.blacklisted) return false;
      // Hidden by the driver themselves (only possible at all once admin
      // has enabled the visibility toggle in Profile.jsx) — excluded from
      // discovery regardless of whether the feature is currently on or off,
      // since a driver who went incognito while it was on shouldn't
      // reappear the moment it's toggled off again without them acting.
      if (d.profile_visible === false) return false;
      if (search && !d.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (minRating > 0 && (d.rating || 0) < minRating) return false;
      if (minExperience && d.driving_experience !== minExperience) return false;
      if (verifiedOnly && !d.id_verified && !d.licence_verified) return false;
      return true;
    });
  }, [drivers, search, minRating, minExperience, verifiedOnly]);

  const fetchDriverDetails = async (driverId) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', driverId).single();
      setSelectedDriver(data);
    } catch (err) {
      toast.error('Could not load driver profile.');
    }
  };

  const handlePreviewContract = async (vehicle) => {
    setContractVehicle(vehicle);
    try {
      let sections;
      if (Array.isArray(vehicle.draft_contract_sections) && vehicle.draft_contract_sections.length > 0) {
        sections = mergeDriverIntoDraft(vehicle.draft_contract_sections, {}, selectedDriver);
      } else {
        sections = generateContractSections({}, vehicle, selectedDriver, user);
      }
      setContractSections(sections);
      setContractModal(true);
    } catch (err) {
      toast.error('Could not generate contract preview.');
    }
  };

  const handleSendContract = async () => {
    if (!contractVehicle || !selectedDriver) return;
    setSendingContract(true);
    try {
      const flatText = flattenContractSections(contractSections);
      const { data: rental, error } = await supabase.from('rentals').insert({
        vehicle_id: contractVehicle.id,
        owner_id: user.id,
        driver_id: selectedDriver.id,
        status: 'awaiting_driver_confirmation',
        contract_sections: contractSections,
        contract_text: flatText,
      }).select().single();
      if (error) throw error;

      toast.success('Contract sent to driver!');
      try {
        await notify(
          selectedDriver.id,
          'rental_contract',
          'New Rental Contract',
          'An owner has sent you a rental contract. Open your dashboard to review and accept.',
          { rental_id: rental.id }
        );
      } catch { /* non-fatal */ }

      setContractModal(false);
      setSelectedDriver(null);
    } catch (err) {
      toast.error('Could not send contract: ' + err.message);
    } finally {
      setSendingContract(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto pb-24">
      <PageHeader title="Find Drivers" subtitle="Browse drivers looking to rent a vehicle" backTo="/home" />

      {/* Search + filters */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="icon" onClick={() => setShowFilters(v => !v)}>
          <SlidersHorizontal className="w-4 h-4" />
        </Button>
      </div>

      {showFilters && (
        <Card className="p-4 mb-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Minimum Rating</label>
            <Select value={String(minRating)} onValueChange={v => setMinRating(Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any</SelectItem>
                <SelectItem value="3">3+ stars</SelectItem>
                <SelectItem value="4">4+ stars</SelectItem>
                <SelectItem value="4.5">4.5+ stars</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Driving Experience</label>
            <Select value={minExperience} onValueChange={setMinExperience}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                <SelectItem value="1-2">1 – 2 years</SelectItem>
                <SelectItem value="3-5">3 – 5 years</SelectItem>
                <SelectItem value="6+">6+ years</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={verifiedOnly} onChange={e => setVerifiedOnly(e.target.checked)} />
            Verified drivers only
          </label>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : filteredDrivers.length === 0 ? (
        <EmptyState icon="🔍" title="No drivers found" description="Try adjusting your filters" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredDrivers.map(d => (
            <Card key={d.id} className="p-4 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => fetchDriverDetails(d.id)}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                  {d.avatar_url ? <img src={d.avatar_url} alt="" className="w-full h-full object-cover" /> : <User className="w-5 h-5 text-primary/50" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{d.full_name || 'Driver'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StarRating value={Math.round(d.rating || 0)} size="xs" />
                    {(d.id_verified || d.licence_verified) && <ShieldCheck className="w-3.5 h-3.5 text-green-600" />}
                  </div>
                  {d.location && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3" />{d.location}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Driver detail modal */}
      {selectedDriver && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center p-4 pt-8 sm:pt-4 bg-black/40 overflow-y-auto" onClick={() => setSelectedDriver(null)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full border border-border flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="shrink-0 border-b border-border flex items-center justify-between px-6 py-4">
              <h2 className="text-lg font-bold">Driver Profile</h2>
              <button onClick={() => setSelectedDriver(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <div className="overflow-y-auto px-6 py-4">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                  {selectedDriver.avatar_url ? <img src={selectedDriver.avatar_url} alt="" className="w-full h-full object-cover" /> : <User className="w-6 h-6 text-primary/50" />}
                </div>
                <div>
                  <p className="font-semibold text-lg">{selectedDriver.full_name || 'Driver'}</p>
                  <StarRating value={Math.round(selectedDriver.rating || 0)} size="sm" showValue />
                </div>
              </div>
              {selectedDriver.location && <p className="text-sm text-muted-foreground mb-1">📍 {selectedDriver.location}</p>}
              {selectedDriver.driving_experience && <p className="text-sm text-muted-foreground mb-4">🚗 {selectedDriver.driving_experience} years experience</p>}

              <div className="flex gap-2 mb-4">
                <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => navigate(`/messages?userId=${selectedDriver.id}`)}>
                  <MessageCircle className="w-3.5 h-3.5" /> Message
                </Button>
              </div>

              {ownerVehicles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Send Rental Contract</p>
                  <div className="space-y-2">
                    {ownerVehicles.filter(v => v.status === 'available').map(v => (
                      <button
                        key={v.id}
                        onClick={() => handlePreviewContract(v)}
                        className="w-full text-left p-3 rounded-xl border border-border hover:border-primary/40 transition-colors flex items-center justify-between gap-2"
                      >
                        <span className="text-sm font-medium">{v.make} {v.model}</span>
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Contract preview modal */}
      {contractModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center p-4 pt-8 sm:pt-4 bg-black/40 overflow-y-auto" onClick={() => setContractModal(false)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-4xl w-full p-4 sm:p-6 border border-border flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="text-xl font-bold">Preview & Send Contract</h2>
              <button onClick={() => setContractModal(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            <div className="rounded-xl p-2 sm:p-3 flex-1 overflow-y-auto mb-4 min-h-0 bg-background border-2 border-primary/30">
              <ContractSectionsList sections={contractSections} onChange={setContractSections} />
            </div>
            <div className="flex gap-3 shrink-0">
              <Button variant="outline" className="flex-1" onClick={() => setContractModal(false)}>Cancel</Button>
              <Button className="flex-1 gap-2" disabled={sendingContract} onClick={handleSendContract}>
                {sendingContract ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {sendingContract ? 'Sending…' : 'Send to Driver'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
