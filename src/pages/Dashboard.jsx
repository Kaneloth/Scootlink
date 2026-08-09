import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { createPortal } from 'react-dom';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { auth, Vehicle, Rental, supabase } from '@/api/supabaseData';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Search, Bike, Users, Car, ShieldCheck, AlertTriangle,
  Check, X, User as UserIcon, MessageCircle, Loader2, StopCircle, Coins,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Star, RefreshCw, Megaphone, Bell,
  MapPin, Clock, FileText
} from 'lucide-react';
import { toast } from 'sonner';
import { notify } from '@/lib/notify';
import { downloadContractPDF } from '@/lib/contractExport';
import { generateContractSections, flattenContractSections, mergeDriverIntoDraft } from '@/lib/contractSections';
import ContractSectionsList from '@/components/contract/ContractSectionsList';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/dashboard/StatCard';
import InsufficientCreditsModal from '@/components/credits/InsufficientCreditsModal';
import { useCredits } from '@/hooks/useCredits';

import VehicleCard from '@/components/vehicles/VehicleCard';
import RentalCard from '@/components/dashboard/RentalCard';
import EmptyState from '@/components/common/EmptyState';
import LeaveReviewModal from '@/components/reviews/LeaveReviewModal';
import StarRating from '@/components/reviews/StarRating';
import ImageLightbox from '@/components/ui/ImageLightbox';

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

// ─── Top-up modal ───────────────────────────────────────────────────────────
// Same packages/copy as the Credits tab in Settings — shown when an owner
// doesn't have enough credits to finalise a rental agreement.
const TOPUP_PACKAGES = [
  { id: 'starter',  label: 'Starter Pack',  price: 49,  credits: 250  },
  { id: 'standard', label: 'Standard Pack', price: 79,  credits: 450, popular: true },
  { id: 'pro',      label: 'Pro Pack',      price: 129, credits: 750  },
  { id: 'business', label: 'Business Pack', price: 199, credits: 1250 },
];

const TOPUP_CREDIT_COSTS = [
  { icon: '💬', action: 'Start a chat',              cost: '50 credits'  },
  { icon: '🚗', action: 'List a vehicle (1st)',       cost: '250 credits' },
  { icon: '🚗', action: 'List a vehicle (2nd)',       cost: '200 credits' },
  { icon: '🚗', action: 'List a vehicle (3rd+)',      cost: '175 credits' },
  { icon: '📝', action: 'Sign a rental contract',     cost: '200 credits' },
];

function TopUpModal({ onClose }) {
  const { balance, loading, refetch } = useCredits();
  const [purchasing,  setPurchasing]  = useState(null);
  const [selectedPkg, setSelectedPkg] = useState(
    TOPUP_PACKAGES.find(p => p.popular)?.id || TOPUP_PACKAGES[1].id
  );
  const [showCosts, setShowCosts] = useState(false);

  const handlePurchase = async () => {
    const pkg = TOPUP_PACKAGES.find(p => p.id === selectedPkg);
    if (!pkg) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { toast.error('Please sign in first.'); return; }
    setPurchasing(pkg.id);

    try {
      const res = await fetch('/.netlify/functions/payfast-initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ package_id: pkg.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start payment');

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = data.action_url;
      Object.entries(data.fields).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type  = 'hidden';
        input.name  = key;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      toast.error(err.message || 'Could not start payment. Please try again.');
      setPurchasing(null);
    }
  };

  const selected = TOPUP_PACKAGES.find(p => p.id === selectedPkg);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-bold text-foreground">Buy Credits</h2>
          <button onClick={onClose} className="p-3 rounded-lg hover:bg-muted transition-colors -mr-1" style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Balance */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-primary/5 border border-primary/20">
            <div>
              <p className="text-xs text-muted-foreground">Your credit balance</p>
              {loading
                ? <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mt-1" />
                : <p className="text-3xl font-bold text-primary">{balance}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">credits · never expire</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Coins className="w-6 h-6 text-primary" />
            </div>
          </div>

          {/* Packages */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Choose a package</p>
            <div className="space-y-2.5">
              {TOPUP_PACKAGES.map(pkg => {
                const isSelected = selectedPkg === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    onClick={() => setSelectedPkg(pkg.id)}
                    disabled={purchasing !== null}
                    className={`w-full text-left rounded-2xl border-2 px-4 py-3.5 transition-all disabled:opacity-60 ${
                      isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-primary/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${isSelected ? 'border-primary' : 'border-muted-foreground/40'}`}>
                          {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-xl font-extrabold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                            {pkg.credits.toLocaleString()}
                          </span>
                          <span className="text-sm text-muted-foreground font-medium">credits</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {pkg.popular && (
                          <span className="text-[10px] font-bold bg-primary text-white px-2 py-0.5 rounded-full">🔥 POPULAR</span>
                        )}
                        <span className={`text-base font-bold ${isSelected ? 'text-primary' : 'text-foreground'}`}>R{pkg.price}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pay button */}
          <Button onClick={handlePurchase} disabled={purchasing !== null} className="w-full h-12 text-base font-bold rounded-2xl gap-2">
            {purchasing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              : <>Pay R{selected?.price} — Get {selected?.credits.toLocaleString()} credits</>}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground -mt-3">
            Secure payment via card or EFT · Credits added instantly
          </p>

          {/* How far your credits go — collapsible */}
          <div className="border border-border rounded-2xl overflow-hidden">
            <button onClick={() => setShowCosts(v => !v)} className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-muted/40 transition-colors">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How far your credits go</p>
              {showCosts ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showCosts && (
              <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                {TOPUP_CREDIT_COSTS.map(({ icon, action, cost }) => (
                  <div key={action} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{icon}</span>
                      <p className="text-xs text-muted-foreground">{action}</p>
                    </div>
                    <span className="text-xs font-semibold text-foreground shrink-0 ml-2">{cost}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-border">
                  <p className="text-[11px] text-muted-foreground text-center">Credits never expire · Sign-up bonus included</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Detail Panel ─────────────────────────────────────────────────────
// Standalone component so it can be used as a direct child of createPortal
// without the broken .map() pattern.
function ProfileDetailPanel({ profile, role, currentYear, onClose, onMessage, canMessage, onMessageBlocked }) {
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [platformHistory, setPlatformHistory] = useState([]);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('platform_history')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setPlatformHistory(data || []))
      .catch(() => {});
  }, [profile?.id]);

  const row = (label, value, extra = {}) => value ? (
    <div className={`flex justify-between px-4 py-2.5 ${extra.wrap ? 'gap-4' : ''}`}>
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`font-medium ${extra.right ? 'text-right' : ''} ${extra.mono ? 'font-mono tracking-wide' : ''}`}>{value}</span>
    </div>
  ) : null;

  return (
    <>
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
            <div
              className={`w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary overflow-hidden shrink-0 ${profile.avatar_visible !== false && profile.avatar_url ? 'cursor-zoom-in' : ''}`}
              onClick={() => { if (profile.avatar_visible !== false && profile.avatar_url) setLightboxSrc(profile.avatar_url); }}
            >
              {profile.avatar_visible !== false && profile.avatar_url
                ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover pointer-events-none" />
                : (profile.full_name?.[0]?.toUpperCase() || '?')}
            </div>
            <div>
              <p className="font-semibold text-lg leading-tight">{profile.full_name || role}</p>
              <p className="text-xs mt-1">
                {profile.id_verified && profile.licence_verified
                  ? <span className="text-green-700 font-medium">🛡️ Fully Verified</span>
                  : profile.id_verified
                    ? <span className="text-green-600 font-medium">✅ ID Verified</span>
                    : profile.licence_verified
                      ? <span className="text-green-600 font-medium">🪪 Licence Verified</span>
                      : null}
              </p>
            </div>
          </div>

          {/* Detail rows — only renders rows that have data */}
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden text-sm mb-5">
            {row('Gender',       profile.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : null)}
            {row('Citizenship',  profile.citizenship)}
            {row('City / Area',  profile.location)}
            {row('Driving Experience', { '1-2': '1 – 2 years', '3-5': '3 – 5 years', '6+': '6+ years' }[profile.driving_experience] || null)}
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
              <span className="text-muted-foreground">Skootlink Rating</span>
              <span><StarRating value={Math.round(profile.rating || 0)} size="sm" showValue /></span>
            </div>
          </div>

          {/* Platform History — self-reported gig-platform work history, hidden entirely if none */}
          {platformHistory.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">Platform History</p>
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden text-sm">
                {platformHistory.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{entry.platform}</span>
                      {entry.role && <span className="text-xs text-muted-foreground">· {entry.role}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-0.5 text-amber-500 text-xs font-semibold">
                        <Star className="w-3.5 h-3.5 fill-current" /> {Number(entry.rating).toFixed(1)}
                      </span>
                      {entry.verification_status === 'verified' ? (
                        <span className="text-[10px] text-green-600 font-medium">✅ Verified</span>
                      ) : entry.verification_status === 'pending' ? (
                        <span className="text-[10px] text-amber-600 font-medium">⏳ Pending</span>
                      ) : (
                        // 'unverified' or 'rejected' both fall back to the same
                        // trust level — a rejected screenshot doesn't necessarily
                        // mean the claim is false, just unconfirmed.
                        <span className="text-[10px] text-muted-foreground">Self-reported</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
    <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [freshAccountType, setFreshAccountType] = useState(null);
 
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
  const [contractSections, setContractSections] = useState([]);
  // 'accept' = owner signing a fresh proposal
  // 'edit'   = owner updating an already-accepted contract
  // 'review' = driver reading and confirming
  const [contractEditMode, setContractEditMode] = useState('accept');

  // Insufficient-credits modal (shown when owner can't afford to finalise a rental)
  const [showCreditsNeededModal, setShowCreditsNeededModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  const ownerVehiclesRef = useRef(null);
  const ownerAssignmentsRef = useRef(null);
  const ownerNearbyDriversRef = useRef(null);
  const driverAvailableRef = useRef(null);
  const driverActiveRentalsRef = useRef(null);
  const reviewsSectionRef = useRef(null);
  const tabsRef = useRef(null);

  const DRIVER_VEHICLES_PAGE_SIZE = 10;
  const [driverVehiclesPage, setDriverVehiclesPage] = useState(1);

  const OWNER_DRIVERS_PAGE_SIZE = 10;
  const [ownerDriversPage, setOwnerDriversPage] = useState(1);

  // Nearby Driver detail modal — deliberately separate state from
  // selectedDriver/ProfileDetailPanel above (which is shared by Active
  // Assignments etc. and has no contract-sending capability). This mirrors
  // FindDrivers.jsx's own driver-detail + "Send Rental Contract" flow so the
  // two surfaces behave identically, reusing the same contract-generation
  // helpers and the owner's own `vehicles` (no separate fetch needed here).
  const [nearbyDriverDetail,      setNearbyDriverDetail]      = useState(null);
  const [nearbyDriverLightboxSrc, setNearbyDriverLightboxSrc] = useState(null);
  const [showNearbyContractForm,  setShowNearbyContractForm]  = useState(false);
  const [nearbyContractForm,      setNearbyContractForm]      = useState({
    vehicle_id:     '',
    start_date:     new Date().toISOString().split('T')[0],
    end_date:       new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    price_per_week: '',
    deposit:        '',
    message:        '',
  });
  const [nearbyContractSections,       setNearbyContractSections]       = useState([]);
  const [showNearbyContractPreview,    setShowNearbyContractPreview]    = useState(false);
  const [sendingNearbyContract,        setSendingNearbyContract]        = useState(false);

  const openNearbyDriverDetail = (driver) => {
    setNearbyDriverDetail(driver);
    setShowNearbyContractForm(false);
    setNearbyContractForm({
      vehicle_id: '', price_per_week: '', deposit: '', message: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
  };

  const [bothTab, setBothTab] = useState('owner');

  // Counterparty names cache: { [userId]: displayName }
  const [counterpartyNames, setCounterpartyNames] = useState({});

  useEffect(() => {
    auth.me().then(async u => {
      setUser(u);
      try {
        const { data } = await supabase
          .from('profiles')
          .select('account_type, verification_banner_dismissed')
          .eq('id', u.id)
          .single();
        if (data?.account_type) setFreshAccountType(data.account_type);
        if (data?.verification_banner_dismissed) setBannerDismissed(true);
      } catch { /* fall back to u.account_type */ }
    }).catch(() => {});
  }, []);

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const dismissVerificationBanner = async () => {
    setBannerDismissed(true); // hide immediately, don't wait on the network
    if (!user?.id) return;
    try {
      await supabase.from('profiles').update({ verification_banner_dismissed: true }).eq('id', user.id);
    } catch (err) {
      console.error('[Dashboard] Failed to persist banner dismissal:', err);
      // Non-fatal — worst case it reappears next session, not a big deal.
    }
  };

  // ── Admin announcements ──────────────────────────────────────────────────
  const [announcement, setAnnouncement] = useState(null);
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data: active } = await supabase
          .from('announcements')
          .select('id, title, body, severity, target_type')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(20);
        if (!active?.length) return;

        const { data: dismissals } = await supabase
          .from('announcement_dismissals')
          .select('announcement_id')
          .eq('user_id', user.id);
        const dismissedIds = new Set((dismissals || []).map(d => d.announcement_id));

        const specificIds = active.filter(a => a.target_type === 'specific').map(a => a.id);
        let myTargetedIds = new Set();
        if (specificIds.length) {
          const { data: recipientRows } = await supabase
            .from('announcement_recipients')
            .select('announcement_id')
            .eq('user_id', user.id)
            .in('announcement_id', specificIds);
          myTargetedIds = new Set((recipientRows || []).map(r => r.announcement_id));
        }

        const applicable = active.find(a =>
          !dismissedIds.has(a.id) &&
          (a.target_type === 'all' || myTargetedIds.has(a.id))
        );
        if (applicable) setAnnouncement(applicable);
      } catch (err) {
        console.error('[Dashboard] Failed to load announcement:', err);
      }
    })();
  }, [user?.id]);

  const dismissAnnouncement = async () => {
    if (!announcement || !user?.id) return;
    const id = announcement.id;
    setAnnouncement(null); // hide immediately
    try {
      await supabase.from('announcement_dismissals').upsert({ user_id: user.id, announcement_id: id }, { onConflict: 'user_id,announcement_id' });
    } catch (err) {
      console.error('[Dashboard] Failed to persist announcement dismissal:', err);
    }
  };

  const queryClient = useQueryClient();
  const accountType = freshAccountType || user?.account_type || 'driver';

  const { data: vehicles = [] } = useQuery({
    queryKey: ['my-vehicles'],
    queryFn: () => Vehicle.filter({ owner_id: user?.id }),
    enabled: !!user?.id,
  });

  // ── Automated reminder rules ──────────────────────────────────────────────
  // Distinct from admin announcements — these trigger automatically based on
  // the user's own account state (profile completeness, verification status,
  // etc.), no manual sending required.
  const [reminder, setReminder] = useState(null);
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data: activeRules } = await supabase
          .from('reminder_rules')
          .select('id, title, body, severity, condition_type')
          .eq('is_active', true)
          .order('created_at', { ascending: false });
        if (!activeRules?.length) return;

        const { data: dismissals } = await supabase
          .from('reminder_dismissals')
          .select('rule_id')
          .eq('user_id', user.id);
        const dismissedIds = new Set((dismissals || []).map(d => d.rule_id));

        const hasMinProfile = !!(user.full_name?.trim() && user.phone?.trim() && user.location?.trim());
        const conditionMatches = {
          profile_incomplete: () => !hasMinProfile,
          not_verified: () => !user.id_verified && !user.licence_verified,
          no_vehicle_listed: () => (accountType === 'owner' || accountType === 'both') && vehicles.length === 0,
        };

        const applicable = activeRules.find(r =>
          !dismissedIds.has(r.id) && conditionMatches[r.condition_type]?.()
        );
        if (applicable) setReminder(applicable);
      } catch (err) {
        console.error('[Dashboard] Failed to load reminder rules:', err);
      }
    })();
  }, [user?.id, accountType, vehicles.length]);

  const dismissReminder = async () => {
    if (!reminder || !user?.id) return;
    const id = reminder.id;
    setReminder(null);
    try {
      await supabase.from('reminder_dismissals').upsert({ user_id: user.id, rule_id: id }, { onConflict: 'user_id,rule_id' });
    } catch (err) {
      console.error('[Dashboard] Failed to persist reminder dismissal:', err);
    }
  };

  const { data: allVehicles = [] } = useQuery({
    queryKey: ['all-vehicles'],
    queryFn: () => Vehicle.filter({ status: 'available' }),
  });

  // Distance-filtered specifically for the driver's "Available Vehicles"
  // list — kept separate from allVehicles above, which stays unfiltered
  // since it's also used as a general lookup fallback elsewhere (rental
  // cards need to find a vehicle's details even if it's far away).
  const { data: nearbyVehicles = [] } = useQuery({
    // user.location is included so changing your location actually busts the
    // cache and triggers a fresh fetch — previously this only keyed on
    // user.id, which never changes, so the list silently kept showing
    // results from your old location no matter how far you moved.
    queryKey: ['nearby-vehicles', user?.id, user?.location],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_nearby_vehicles', {
        p_user_id: user.id,
        p_radius_meters: 50000,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Distance-filtered drivers for the owner's "Nearby Drivers" list — same
  // pattern as nearbyVehicles above, fixed at 20km per the feature spec.
  const { data: nearbyDriversRaw = [] } = useQuery({
    queryKey: ['nearby-drivers', user?.id, user?.location],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_nearby_drivers', {
        p_user_id: user.id,
        p_radius_meters: 20000,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Same visibility rule as FindDrivers.jsx — a driver who's hidden their
  // profile from search shouldn't surface here either.
  const nearbyDrivers = nearbyDriversRaw.filter(d => d.profile_visible !== false);

  const nearbySelectedVehicle = vehicles.find(v => String(v.id) === String(nearbyContractForm.vehicle_id)) || null;

  const nearbyContractEstimate = (() => {
    if (!nearbySelectedVehicle || !nearbyContractForm.start_date || !nearbyContractForm.end_date) return null;
    const days  = Math.max(1, Math.ceil((new Date(nearbyContractForm.end_date) - new Date(nearbyContractForm.start_date)) / (1000 * 60 * 60 * 24)));
    const weeks = Math.ceil(days / 7);
    const rate  = parseFloat(nearbyContractForm.price_per_week) || nearbySelectedVehicle.price_per_week || 0;
    return { weeks, total: weeks * rate };
  })();

  const handlePreviewNearbyContract = () => {
    if (!nearbyContractForm.vehicle_id)                                  { toast.error('Please select a vehicle'); return; }
    if (!nearbyContractForm.start_date || !nearbyContractForm.end_date)  { toast.error('Please set the rental dates'); return; }
    if (!nearbyContractForm.price_per_week)                              { toast.error('Please enter the weekly rate'); return; }

    const vehicle = vehicles.find(v => String(v.id) === String(nearbyContractForm.vehicle_id));
    // Same draft-preference logic as openContractModal below and
    // FindDrivers.jsx's handlePreviewContract — prefer the vehicle's saved
    // Briefcase contract draft if it has one, otherwise generate fresh.
    let sections;
    if (Array.isArray(vehicle?.draft_contract_sections) && vehicle.draft_contract_sections.length > 0) {
      sections = mergeDriverIntoDraft(vehicle.draft_contract_sections, nearbyContractForm, nearbyDriverDetail);
    } else {
      sections = generateContractSections(nearbyContractForm, vehicle, nearbyDriverDetail, user);
    }
    setNearbyContractSections(sections);
    setShowNearbyContractPreview(true);
  };

  const handleSendNearbyContract = async () => {
    if (!nearbyDriverDetail || !user) return;
    setSendingNearbyContract(true);
    try {
      const { error } = await supabase.from('rentals').insert([{
        vehicle_id:     nearbyContractForm.vehicle_id,
        owner_id:       user.id,
        driver_id:      nearbyDriverDetail.id,
        start_date:     nearbyContractForm.start_date,
        end_date:       nearbyContractForm.end_date,
        status:         'awaiting_driver_confirmation',
        price_per_week: parseFloat(nearbyContractForm.price_per_week),
        deposit:        parseFloat(nearbyContractForm.deposit) || 0,
        message:        nearbyContractForm.message || '',
        contract_sections: nearbyContractSections,
        contract_text:  flattenContractSections(nearbyContractSections),
      }]);
      if (error) throw error;

      try {
        await notify(
          nearbyDriverDetail.id,
          'rental_contract',
          'New Rental Contract',
          `${user?.full_name?.split(' ')[0] || 'An owner'} has sent you a rental contract. Open your dashboard to review and confirm.`,
          { owner_id: user?.id }
        );
      } catch { /* notification failure must never block the main flow */ }

      toast.success(`Contract sent to ${nearbyDriverDetail.full_name?.split(' ')[0] || 'driver'}! They'll confirm on their dashboard.`);
      setNearbyDriverDetail(null);
      setShowNearbyContractForm(false);
      setShowNearbyContractPreview(false);
    } catch (err) {
      toast.error('Failed to send contract: ' + (err.message || 'please try again'));
    } finally {
      setSendingNearbyContract(false);
    }
  };

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
      .select('id, full_name, email, phone, location, license_year, license_number, verified, id_verified, licence_verified, rating')
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

  // Track which completed rentals this user has already reviewed so we can hide them
  const { data: myReviews = [] } = useQuery({
    queryKey: ['my-reviews'],
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from('reviews')
          .select('rental_id')
          .eq('reviewer_id', user.id);
        return data || [];
      } catch { return []; }
    },
    enabled: !!user?.id,
  });
  const reviewedRentalIds = new Set((myReviews || []).map(r => r.rental_id).filter(Boolean));

  const availableForMe = nearbyVehicles.filter(v => v.owner_id !== user?.id);

  useEffect(() => {
    setDriverVehiclesPage(1);
  }, [availableForMe.length]);

  useEffect(() => {
    setOwnerDriversPage(1);
  }, [nearbyDrivers.length]);


  const completedRentals = rentals
    .filter(r => r.status === 'completed')
    .filter(r => !reviewedRentalIds.has(r.id));

  const ownerRentals = rentals.filter(r => r.owner_id === user?.id);
  const ownerPendingRentals = ownerRentals.filter(r => r.status === 'pending');
  const ownerAwaitingRentals = ownerRentals.filter(r => r.status === 'awaiting_driver_confirmation');
  const ownerDriverAcceptedRentals = ownerRentals.filter(r => r.status === 'driver_accepted');
  const ownerActiveRentals = ownerRentals.filter(r => r.status === 'active');

  const driverPendingConfRentals = rentals.filter(r => r.driver_id === user?.id && r.status === 'awaiting_driver_confirmation');
  const driverAcceptedRentals = rentals.filter(r => r.driver_id === user?.id && r.status === 'driver_accepted');
  const driverActiveRentals = rentals.filter(r => r.driver_id === user?.id && r.status === 'active');

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
        try {
          const [driverProfile] = await fetchProfilesViaFunction([rental.driver_id]);
          await notify(
            rental.driver_id,
            'rental_accepted',
            'Proposal Accepted!',
            'Your rental proposal has been accepted. Open your dashboard to review and confirm the agreement.',
            { rental_id: rental.id }
          );
        } catch { /* notification failure must never block the main flow */ }
      } else {
        await Rental.update(rentalId, { status: 'rejected' });
        toast.success('Proposal rejected.');
      }
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['nearby-vehicles'] });
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

  // Google's official in-app review popup — shown at most once per user,
  // ever, tracked server-side so it doesn't repeat across devices. Note
  // that Google's own Play Core library also applies its own internal
  // quota on top of this (it won't necessarily display every single time
  // requestReview() is called, by design, to avoid over-prompting users
  // platform-wide) — this just stops *us* from asking again once we know
  // we already have.
  const maybePromptReview = async () => {
    if (!user?.id || !Capacitor.isNativePlatform()) return;
    try {
      const { data } = await supabase.from('profiles').select('review_prompt_shown_at').eq('id', user.id).single();
      if (data?.review_prompt_shown_at) return;

      // Mark as shown before requesting — if the request itself fails or
      // the user dismisses it, we still don't want to prompt again on
      // their very next signing.
      await supabase.from('profiles').update({ review_prompt_shown_at: new Date().toISOString() }).eq('id', user.id);

      const { InAppReview } = await import('@capacitor-community/in-app-review');
      await InAppReview.requestReview();
    } catch (err) {
      console.error('[Dashboard] Review prompt failed (non-fatal):', err);
    }
  };

  const handleDriverConfirm = async () => {
    if (!selectedProposal) return;
    try {
      await safeRentalUpdate(
        selectedProposal.id,
        { status: 'driver_accepted' },
        {}
      );
      toast.success('Contract accepted! The owner will finalise and activate the rental.');

      // Notify the owner that driver has accepted
      try {
        await notify(
          selectedProposal.owner_id,
          'rental_accepted',
          'Driver Accepted the Contract!',
          'The driver has reviewed and accepted the rental contract. Go to your dashboard to finalise and activate the rental.',
          { rental_id: selectedProposal.id }
        );
      } catch { /* non-fatal */ }

      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      maybePromptReview();
    } catch (err) {
      toast.error('Could not accept contract: ' + err.message);
    } finally {
      closeContractModal();
    }
  };

  // Owner's final confirm — deducts 200 credits, activates rental, downloads PDF
  const handleOwnerFinalise = async () => {
    if (!selectedProposal) return;

    // Deduct 200 credits from the owner for accessing the rental agreement
    // — admins are exempt from all credit gates.
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const isAdminUser = currentUser?.user_metadata?.is_admin === true
      || ['kaneloth@skootlink.co.za'].includes(currentUser?.email);
    if (currentUser && !isAdminUser) {
      const { error: creditErr } = await supabase.rpc('deduct_credits', {
        p_user_id:     currentUser.id,
        p_amount:      200,
        p_type:        'spend',
        p_description: 'Access rental agreement',
        p_ref_id:      selectedProposal.id,
      });
      if (creditErr?.message?.includes('insufficient_credits')) {
        setShowCreditsNeededModal(true);
        return;
      }
    }

    try {
      const rental = rentals.find(r => r.id === selectedProposal.id);
      if (!rental) return;
      const flatText = flattenContractSections(contractSections);
      await safeRentalUpdate(
        rental.id,
        { status: 'active', contract_sections: contractSections, contract_text: flatText },
        { confirmed_at: new Date().toISOString() }
      );
      await Vehicle.update(rental.vehicle_id, { status: 'rented' });
      toast.success('Rental activated!');

      // Download signed contract PDF
      const vehicle =
        vehicles.find(v => v.id === rental.vehicle_id) ||
        allVehiclesLookup.find(v => v.id === rental.vehicle_id) ||
        allVehicles.find(v => v.id === rental.vehicle_id);
      const vehicleInfo = vehicle
        ? `${vehicle.make} ${vehicle.model}${vehicle.year ? ` (${vehicle.year})` : ''}`.trim()
        : '';
      try {
        await downloadContractPDF(flatText, rental.id, vehicleInfo);
        toast.info('Signed agreement downloaded. Driver can also download it from My Briefcase.');
      } catch (pdfErr) {
        console.error('[Dashboard] PDF download failed:', pdfErr);
        toast.error('Could not download the signed agreement — you can still get it from My Briefcase.');
      }

      // Notify driver that rental is now active
      try {
        await notify(
          rental.driver_id,
          'rental_active',
          'Rental is Now Active!',
          'The owner has finalised the rental. Download the signed agreement from My Briefcase.',
          { rental_id: rental.id }
        );
      } catch { /* non-fatal */ }

      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['nearby-vehicles'] });
      maybePromptReview();
    } catch (err) {
      toast.error('Could not finalise rental: ' + err.message);
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

      // If the vehicle's listing had expired during the rental, it stays
      // hidden from search (listing_state stays 'expired') but its status
      // still flips to 'available' so it shows correctly in My Vehicles.
      // The owner can re-list anytime — vehicles are never deleted.
      await Vehicle.update(rental.vehicle_id, { status: 'available' });

      toast.success('Rental ended. You can now leave a review.');
      try {
        const counterpartyId = rental.owner_id === user?.id ? rental.driver_id : rental.owner_id;
        if (counterpartyId) {
          await notify(
            counterpartyId,
            'rental_ended',
            'Rental Ended',
            'Your rental has ended. Open the app to leave a review.',
            { rental_id: rental.id }
          );
        }
      } catch { /* notification failure must never block the main flow */ }
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['nearby-vehicles'] });
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
  const PROFILE_SELECT_SAFE = 'id, full_name, email, phone, location, license_year, license_number, verified, id_verified, licence_verified, rating';
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
  // Never displays the raw email as a name — if the real profile fetch
  // fails, fall back to a generic label ('Driver') rather than leaking
  // contact info into the UI. Users are meant to connect via in-app
  // messaging first, not see each other's email addresses.
  const fetchDriverDetails = async (driverId, fallbackEmail = '') => {
    setLoadingDriverId(driverId);
    try {
      const data = await fetchFullProfile(driverId);
      setSelectedDriver(data || { id: driverId, email: fallbackEmail, full_name: 'Driver' });
    } catch {
      setSelectedDriver({ id: driverId, email: fallbackEmail, full_name: 'Driver' });
    } finally {
      setLoadingDriverId(null);
    }
  };

  // Opens the owner details panel for the driver's view. Same no-email-
  // as-name-fallback rule as fetchDriverDetails above.
  const fetchOwnerDetails = async (ownerId, fallbackEmail = '') => {
    setLoadingOwnerId(ownerId);
    try {
      const data = await fetchFullProfile(ownerId);
      setSelectedOwner(data || { id: ownerId, email: fallbackEmail, full_name: 'Owner' });
    } catch {
      setSelectedOwner({ id: ownerId, email: fallbackEmail, full_name: 'Owner' });
    } finally {
      setLoadingOwnerId(null);
    }
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

    // Use saved contract_sections when this rental already has a real, edited
    // contract (structured data present) — otherwise check for a saved
    // vehicle draft (Briefcase → Prepare Contract) and merge the driver's
    // real details into it, preserving all the owner's customized wording —
    // otherwise generate a fresh one from scratch. Older rentals saved before
    // this structured format existed won't have contract_sections at all, so
    // they correctly fall through too, exactly like the old contract_text
    // heuristic did.
    let sections;
    if (Array.isArray(rental.contract_sections) && rental.contract_sections.length > 0) {
      sections = rental.contract_sections;
    } else if (Array.isArray(vehicle?.draft_contract_sections) && vehicle.draft_contract_sections.length > 0) {
      sections = mergeDriverIntoDraft(vehicle.draft_contract_sections, rental, driverProfileData);
    } else {
      sections = generateContractSections(rental, vehicle, driverProfileData, user);
    }

    setContractSections(sections);
    setSelectedProposal({ ...rental, contractSections: sections });
    setContractModal(true);
  };

  const closeContractModal = () => {
    setContractModal(false);
    setSelectedProposal(null);
    setContractAgreed(false);
  };

  // Deep-link support: a notification's "View" link can point here with
  // ?proposalId=<rental_id> to jump straight to that pending proposal.
  useEffect(() => {
    const proposalId = searchParams.get('proposalId');
    if (!proposalId || ownerPendingRentals.length === 0) return;
    const rental = ownerPendingRentals.find(r => String(r.id) === String(proposalId));
    if (rental) {
      openContractModal(rental, 'accept');
      scrollToSection(ownerAssignmentsRef);
    }
    // Clear the param so refreshing/closing doesn't keep re-opening the modal
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('proposalId');
      return next;
    }, { replace: true });
  }, [ownerPendingRentals, searchParams]);

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
      await Rental.update(selectedProposal.id, {
        contract_sections: contractSections,
        contract_text: flattenContractSections(contractSections),
      });
      toast.success('Contract updated. Driver will see the new version.');
      closeContractModal();
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    }
  };

  const handleAcceptWithContract = async () => {
    if (!selectedProposal) return;
    try {
      // Save the edited contract and send to driver in one atomic step
      await Rental.update(selectedProposal.id, {
        contract_sections: contractSections,
        contract_text: flattenContractSections(contractSections),
        status: 'awaiting_driver_confirmation',
      });
      toast.success('Contract sent to driver for review!');

      // Notify the driver
      try {
        await notify(
          selectedProposal.driver_id,
          'rental_contract',
          'New Rental Contract',
          'The owner has sent you a rental contract. Open your dashboard to review and accept.',
          { rental_id: selectedProposal.id }
        );
      } catch { /* non-fatal */ }

      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
    } catch (err) {
      toast.error('Could not send contract: ' + err.message);
    } finally {
      closeContractModal();
    }
  };

  // =============== RENDER HELPERS ===============

  const renderOwnerContent = () => (
    <>
      <h3 className="text-lg font-semibold mb-3" ref={ownerVehiclesRef}>My Listed Vehicles</h3>
      {vehicles.length > 0 ? (
        <div className="space-y-3">
          {vehicles.map(v => (
            <VehicleCard key={v.id} vehicle={v} onClick={() => navigate(`/edit-vehicle?id=${v.id}`)} />
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
              const driverName = getCounterpartyName(r.driver_id) || 'Driver';
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
          <p className="text-sm font-medium text-muted-foreground mb-2">AWAITING DRIVER REVIEW</p>
          <div className="space-y-3">
            {ownerAwaitingRentals.map(r => {
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehiclesLookup.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const driverName = getCounterpartyName(r.driver_id) || 'Driver';
              return (
                <Card key={r.id} className="p-4 border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
                  <div className="mb-3">
                    <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                    <p className="text-xs text-muted-foreground">Driver: {driverName}</p>
                    <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                    <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                    Contract sent — waiting for driver to review. Edit if changes were agreed via Messages, or withdraw to cancel.
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

      {ownerDriverAcceptedRentals.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-2">DRIVER ACCEPTED — AWAITING YOUR FINALISATION</p>
          <div className="space-y-3">
            {ownerDriverAcceptedRentals.map(r => {
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehiclesLookup.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const driverName = getCounterpartyName(r.driver_id) || 'Driver';
              return (
                <Card key={r.id} className="p-4 border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800">
                  <div className="mb-3">
                    <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                    <p className="text-xs text-muted-foreground">Driver: {driverName}</p>
                    <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                    <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                  </div>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-3">
                    ✅ Driver has accepted the contract. Review it and confirm to activate the rental.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 gap-1" onClick={() => openContractModal(r, 'finalise')}>
                      <Check className="w-3.5 h-3.5" /> Confirm & Finalise
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => handleWithdrawContract(r)}>
                      ✕ Cancel
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {user && (
        ownerActiveRentals.length > 0 ? (
          <div className="space-y-3">
            {ownerActiveRentals.map(r => {
              const vehicle = vehicles.find(v => v.id === r.vehicle_id) || allVehiclesLookup.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const driverName = getCounterpartyName(r.driver_id) || 'Driver';
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
      )}

      <h3 className="text-lg font-semibold mb-3 mt-8" ref={ownerNearbyDriversRef}>Nearby Drivers</h3>
      {nearbyDrivers.length > 0 ? (
        <>
          <div className="space-y-3">
            {nearbyDrivers
              .slice((ownerDriversPage - 1) * OWNER_DRIVERS_PAGE_SIZE, ownerDriversPage * OWNER_DRIVERS_PAGE_SIZE)
              .map(d => {
                const exp = d.license_year ? currentYear - d.license_year : 0;
                return (
                  <Card
                    key={d.id}
                    className="p-4 border border-border/50 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => openNearbyDriverDetail(d)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0 overflow-hidden ${d.avatar_visible !== false && d.avatar_url ? 'cursor-zoom-in' : ''}`}
                          onClick={(e) => { if (d.avatar_visible !== false && d.avatar_url) { e.stopPropagation(); setNearbyDriverLightboxSrc(d.avatar_url); } }}
                        >
                          {d.avatar_visible !== false && d.avatar_url
                            ? <img src={d.avatar_url} alt="" className="w-full h-full object-cover pointer-events-none" />
                            : (d.full_name?.[0] || '?')}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-semibold text-foreground text-sm truncate">{d.full_name || 'Driver'}</h4>
                            {(d.verification_badge === 'fully_verified' || d.verification_badge === 'id_verified') && (
                              <span className="text-xs text-green-600 font-medium leading-none">✅ ID</span>
                            )}
                            {(d.verification_badge === 'fully_verified' || d.verification_badge === 'dl_verified' || d.verification_badge === 'licence_only') && (
                              <span className="text-xs text-blue-600 font-medium leading-none">🛡️ DL</span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                            {d.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{d.location}</span>}
                            {exp > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{exp}y exp</span>}
                            <StarRating value={Math.round(d.rating || 0)} size="sm" showValue />
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-xs px-2.5 py-1.5"
                        onClick={(e) => { e.stopPropagation(); openNearbyDriverDetail(d); }}
                      >
                        <UserIcon className="w-3 h-3 mr-1" /> Details
                      </Button>
                    </div>
                  </Card>
                );
              })}
          </div>

          {nearbyDrivers.length > OWNER_DRIVERS_PAGE_SIZE && (() => {
            const totalPages = Math.ceil(nearbyDrivers.length / OWNER_DRIVERS_PAGE_SIZE);
            return (
              <div className="flex items-center justify-center gap-4 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={ownerDriversPage === 1}
                  onClick={() => {
                    setOwnerDriversPage(p => Math.max(1, p - 1));
                    ownerNearbyDriversRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {ownerDriversPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={ownerDriversPage === totalPages}
                  onClick={() => {
                    setOwnerDriversPage(p => Math.min(totalPages, p + 1));
                    ownerNearbyDriversRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            );
          })()}
        </>
      ) : (
        <EmptyState icon="🔍" title="No nearby drivers" description="Check back later as more drivers join" />
      )}
    </>
  );

  const renderDriverContent = () => (
    <>
      {driverPendingConfRentals.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Contract Pending Your Review</h3>
          <div className="space-y-3">
            {driverPendingConfRentals.map(r => {
              const vehicle = allVehiclesLookup.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const ownerName = getCounterpartyName(r.owner_id) || 'Owner';
              return (
                <Card key={r.id} className="p-4 border border-primary/30 bg-primary/5">
                  <div className="mb-3">
                    <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                    <p className="text-xs text-muted-foreground">Owner: {ownerName}</p>
                    <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                    <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Review the contract carefully. If you need changes, use Messages to discuss with the owner first.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 gap-1" onClick={() => openContractModal(r, 'review')}>
                      <Check className="w-3.5 h-3.5" /> Review & Accept
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1 text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => handleRejectContract(r)}>
                      ✕ Reject
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {driverAcceptedRentals.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Awaiting Owner Finalisation</h3>
          <div className="space-y-3">
            {driverAcceptedRentals.map(r => {
              const vehicle = allVehiclesLookup.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
              const ownerName = getCounterpartyName(r.owner_id) || 'Owner';
              return (
                <Card key={r.id} className="p-4 border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                  <p className="font-semibold">{vehicle ? `${vehicle.make} ${vehicle.model}` : `Vehicle #${r.vehicle_id}`}</p>
                  <p className="text-xs text-muted-foreground">Owner: {ownerName}</p>
                  <p className="text-xs text-muted-foreground">{r.start_date} – {r.end_date}</p>
                  <p className="text-xs font-medium">R {r.price_per_week}/week • Deposit R {r.deposit}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                    ✅ You accepted the contract. Waiting for the owner to confirm and activate the rental.
                  </p>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <h3 className="text-lg font-semibold mb-3" ref={driverActiveRentalsRef}>My Active Rentals</h3>
      {driverActiveRentals.length > 0 ? (
        <div className="space-y-3">
          {driverActiveRentals.map(r => {
            const vehicle = allVehiclesLookup.find(v => v.id === r.vehicle_id) || vehicles.find(v => v.id === r.vehicle_id) || allVehicles.find(v => v.id === r.vehicle_id);
            const ownerName = getCounterpartyName(r.owner_id) || 'Owner';
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

      <h3 className="text-lg font-semibold mb-3 mt-8" ref={driverAvailableRef}>Available Vehicles</h3>
      {availableForMe.length > 0 ? (
        <>
          <div className="space-y-3">
            {availableForMe
              .slice((driverVehiclesPage - 1) * DRIVER_VEHICLES_PAGE_SIZE, driverVehiclesPage * DRIVER_VEHICLES_PAGE_SIZE)
              .map(v => {
                const isAdminUser = user?.user_metadata?.is_admin === true || ['kaneloth@skootlink.co.za'].includes(user?.email);
                const canRent = true; // credits checked at rental request stage
                return canRent ? (
                  <VehicleCard key={v.id} vehicle={v} onClick={() => navigate(`/rental-request?vehicleId=${v.id}`)} />
                ) : (
                  <VehicleCard key={v.id} vehicle={v} />
                );
              })}
          </div>

          {availableForMe.length > DRIVER_VEHICLES_PAGE_SIZE && (() => {
            const totalPages = Math.ceil(availableForMe.length / DRIVER_VEHICLES_PAGE_SIZE);
            return (
              <div className="flex items-center justify-center gap-4 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={driverVehiclesPage === 1}
                  onClick={() => {
                    setDriverVehiclesPage(p => Math.max(1, p - 1));
                    driverAvailableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {driverVehiclesPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={driverVehiclesPage === totalPages}
                  onClick={() => {
                    setDriverVehiclesPage(p => Math.min(totalPages, p + 1));
                    driverAvailableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            );
          })()}
        </>
      ) : (
        <EmptyState icon="🔍" title="No available vehicles" description="Check back later for new listings" />
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
          <div onClick={() => navigateToBothSection('owner', ownerVehiclesRef)} className="cursor-pointer"><StatCard icon={Car} label="My Vehicles" value={vehicles.length} /></div>
          <div onClick={() => navigateToBothSection('driver', driverAvailableRef)} className="cursor-pointer"><StatCard icon={Search} label="Available" value={availableForMe.length} subtitle="Vehicles near you" /></div>
          <div onClick={() => navigateToBothSection('owner', ownerAssignmentsRef)} className="cursor-pointer"><StatCard icon={Bike} label="Active Rentals" value={ownerActiveRentals.length} /></div>
          <div onClick={() => navigateToBothSection('owner', ownerNearbyDriversRef)} className="cursor-pointer"><StatCard icon={Users} label="Nearby Drivers" value={nearbyDrivers.length} subtitle="Within 20km" /></div>
          <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer"><StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} /></div>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
        <div onClick={() => scrollToSection(ownerVehiclesRef)} className="cursor-pointer"><StatCard icon={Car} label="My Vehicles" value={vehicles.length} /></div>
        <div onClick={() => scrollToSection(ownerAssignmentsRef)} className="cursor-pointer"><StatCard icon={Bike} label="Active Rentals" value={ownerActiveRentals.length} /></div>
        <div onClick={() => scrollToSection(ownerNearbyDriversRef)} className="cursor-pointer"><StatCard icon={Users} label="Nearby Drivers" value={nearbyDrivers.length} subtitle="Within 20km" /></div>
        <div onClick={() => scrollToSection(reviewsSectionRef)} className="cursor-pointer"><StatCard icon={Users} label="Rating" value={user?.rating ? `${user.rating.toFixed(1)} ⭐` : 'N/A'} /></div>
      </div>
    );
  };

  const renderActionButtons = () => {
    if (!user) return <ActionButtonsSkeleton />;

    const isAdminUser = user?.user_metadata?.is_admin === true || ['kaneloth@skootlink.co.za'].includes(user?.email);

    // Driver — single primary Find Vehicles button
    if (accountType === 'driver') {
      return (
        <div className="mt-6">
          <Link to="/search-vehicles" className="block w-full">
            <Button className="w-full gap-2 py-5 text-base"><Search className="w-4 h-4" /> Find Vehicles</Button>
          </Link>
        </div>
      );
    }

    // Owner — Add Vehicle (primary) + Find Drivers
    if (accountType === 'owner') {
      return (
        <div className="mt-6">
          <Link to="/add-vehicle" className="block w-full mb-2">
            <Button className="w-full gap-2 py-5 text-base"><Plus className="w-4 h-4" /> Add Vehicle</Button>
          </Link>
          <Link to="/find-drivers" className="block w-full">
            <Button variant="outline" className="w-full gap-2 py-4 text-sm"><Users className="w-4 h-4" /> Find Drivers</Button>
          </Link>
        </div>
      );
    }

    // Both (or admin) — Add Vehicle (primary) + Find Drivers + Find Vehicles
    return (
      <div className="mt-6">
        <Link to="/add-vehicle" className="block w-full mb-2">
          <Button className="w-full gap-2 py-5 text-base"><Plus className="w-4 h-4" /> Add Vehicle</Button>
        </Link>
        <div className="grid grid-cols-2 gap-2">
          <Link to="/find-drivers"><Button variant="outline" className="w-full gap-1.5 py-3 text-xs lg:text-sm"><Users className="w-4 h-4" /> Find Drivers</Button></Link>
          <Link to="/search-vehicles"><Button variant="outline" className="w-full gap-1.5 py-3 text-xs lg:text-sm"><Search className="w-4 h-4" /> Find Vehicles</Button></Link>
        </div>
      </div>
    );
  };

  const currentYear = new Date().getFullYear();

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['all-vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['nearby-vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['all-vehicles-lookup'] }),
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] }),
      queryClient.invalidateQueries({ queryKey: ['my-reviews'] }),
    ]);
    setRefreshing(false);
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        title={`Welcome${user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}`}
        subtitle="Manage your vehicles and rentals"
        action={
          <button onClick={handleRefresh} className="p-1.5 rounded-full hover:bg-muted transition-colors" aria-label="Refresh">
            <RefreshCw className={`w-4 h-4 text-primary ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {/* Automated reminder banner (condition-triggered, not manually sent) */}
      {reminder && (() => {
        const styles = {
          info:    { border: 'border-blue-200', bg: 'bg-blue-50', text: 'text-blue-800', subtext: 'text-blue-700', icon: 'text-blue-500' },
          warning: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', subtext: 'text-amber-700', icon: 'text-amber-500' },
          success: { border: 'border-green-200', bg: 'bg-green-50', text: 'text-green-800', subtext: 'text-green-700', icon: 'text-green-500' },
        }[reminder.severity || 'info'];
        return (
          <Card className={`p-4 border-2 ${styles.border} ${styles.bg} mb-3 flex items-start justify-between gap-3`}>
            <div className="flex items-start gap-3">
              <Bell className={`w-5 h-5 ${styles.icon} shrink-0 mt-0.5`} />
              <div>
                <p className={`text-sm font-semibold ${styles.text}`}>{reminder.title}</p>
                <p className={`text-xs ${styles.subtext}`}>{reminder.body}</p>
              </div>
            </div>
            <button
              onClick={dismissReminder}
              aria-label="Dismiss"
              className={`p-1 rounded-full ${styles.icon} hover:bg-black/5 transition-colors shrink-0`}
            >
              <X className="w-4 h-4" />
            </button>
          </Card>
        );
      })()}

      {/* Banner 1 — profile incomplete */}
      {user && (() => {
        const hasMinProfile = !!(user.full_name?.trim() && user.phone?.trim() && user.location?.trim());
        const missingLocation = !user.location?.trim();
        if (hasMinProfile || user.onboarding_completed) return null;
        return (
          <Card className="p-4 border-2 border-amber-300 bg-amber-50 mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Complete your profile</p>
                <p className="text-xs text-amber-700">
                  {missingLocation
                    ? 'Add your location so owners and drivers can find you'
                    : 'Add your personal details so others can find and trust you'}
                </p>
              </div>
            </div>
            <Link to={missingLocation ? '/profile' : '/onboarding'}>
              <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600">Set Up</Button>
            </Link>
          </Card>
        );
      })()}

      {/* Admin announcement banner */}
      {announcement && (() => {
        const styles = {
          info:    { border: 'border-blue-200', bg: 'bg-blue-50', text: 'text-blue-800', subtext: 'text-blue-700', icon: 'text-blue-500' },
          warning: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', subtext: 'text-amber-700', icon: 'text-amber-500' },
          success: { border: 'border-green-200', bg: 'bg-green-50', text: 'text-green-800', subtext: 'text-green-700', icon: 'text-green-500' },
        }[announcement.severity || 'info'];
        return (
          <Card className={`p-4 border-2 ${styles.border} ${styles.bg} mb-3 flex items-start justify-between gap-3`}>
            <div className="flex items-start gap-3">
              <Megaphone className={`w-5 h-5 ${styles.icon} shrink-0 mt-0.5`} />
              <div>
                <p className={`text-sm font-semibold ${styles.text}`}>{announcement.title}</p>
                <p className={`text-xs ${styles.subtext}`}>{announcement.body}</p>
              </div>
            </div>
            <button
              onClick={dismissAnnouncement}
              aria-label="Dismiss"
              className={`p-1 rounded-full ${styles.icon} hover:bg-black/5 transition-colors shrink-0`}
            >
              <X className="w-4 h-4" />
            </button>
          </Card>
        );
      })()}

      {/* Banner 2 — profile done but not yet verified */}
      {user && (() => {
        const hasMinProfile = !!(user.full_name?.trim() && user.phone?.trim() && user.location?.trim());
        if ((!user.onboarding_completed && !hasMinProfile) || user.verified || user.id_verified || bannerDismissed) return null;
        return (
          <Card className="relative p-4 pr-10 border-2 border-blue-200 bg-blue-50 mb-3 flex items-center justify-between gap-3">
            <button
              onClick={dismissVerificationBanner}
              aria-label="Dismiss"
              className="absolute top-3 right-3 p-1 rounded-full text-blue-400 hover:text-blue-600 hover:bg-blue-100 transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">Get your Verified badge</p>
                <p className="text-xs text-blue-700">Verified users earn a ✅ badge that builds trust with owners and drivers on the platform</p>
              </div>
            </div>
            <Link to="/profile?tab=verification" className="shrink-0"><Button size="sm" variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-100">Verify</Button></Link>
          </Card>
        );
      })()}


     

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
              const targetName = getCounterpartyName(targetId) || (isOwner ? 'Driver' : 'Owner');
              const v = allVehiclesLookup.find(veh => veh.id === r.vehicle_id) || vehicles.find(veh => veh.id === r.vehicle_id) || allVehicles.find(veh => veh.id === r.vehicle_id);
              return (
                <Card key={r.id} className="p-4 border border-border/50 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{v ? `${v.make} ${v.model}` : 'Rental'}</p>
                    <p className="text-xs text-muted-foreground">{isOwner ? 'Driver: ' : 'Owner: '}{targetName}</p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 shrink-0"
                    onClick={() => {
                      setReviewModal({
                        rental: r,
                        targetEmail,
                        targetName,
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
          onClose={() => {
            setReviewModal(null);
            queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
          }}
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
          canMessage={true}
          onMessageBlocked={() => toast.warning('Please upgrade your account to send messages')}
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
          canMessage={true}
          onMessageBlocked={() => toast.warning('Please upgrade your account to send messages')}
        />,
        document.body
      )}

      {/* Nearby Driver detail modal — same shape as FindDrivers.jsx's driver
          detail + Send Rental Contract flow, so the two surfaces match. */}
      {nearbyDriverDetail && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 pt-8 sm:pt-4 bg-black/40 overflow-y-auto"
          onClick={() => { setNearbyDriverDetail(null); setShowNearbyContractForm(false); }}
        >
          <div
            className="bg-card rounded-2xl shadow-xl w-full max-w-md border border-border flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-4 shrink-0 border-b border-border">
              <h2 className="text-xl font-bold truncate">Driver Profile</h2>
              <button
                onClick={() => { setNearbyDriverDetail(null); setShowNearbyContractForm(false); }}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-6 pt-4 flex-1">
              <div className="flex items-center gap-4 mb-4">
                <div
                  className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary shrink-0 overflow-hidden ${nearbyDriverDetail.avatar_visible !== false && nearbyDriverDetail.avatar_url ? 'cursor-zoom-in' : ''}`}
                  onClick={() => { if (nearbyDriverDetail.avatar_visible !== false && nearbyDriverDetail.avatar_url) setNearbyDriverLightboxSrc(nearbyDriverDetail.avatar_url); }}
                >
                  {nearbyDriverDetail.avatar_visible !== false && nearbyDriverDetail.avatar_url
                    ? <img src={nearbyDriverDetail.avatar_url} alt="" className="w-full h-full object-cover pointer-events-none" />
                    : (nearbyDriverDetail.full_name?.[0] || '?')}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-lg truncate">{nearbyDriverDetail.full_name || 'Driver'}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    {(nearbyDriverDetail.verification_badge === 'fully_verified' || nearbyDriverDetail.verification_badge === 'id_verified') && (
                      <span className="text-xs text-green-600 font-medium">✅ ID Verified</span>
                    )}
                    {(nearbyDriverDetail.verification_badge === 'fully_verified' || nearbyDriverDetail.verification_badge === 'dl_verified' || nearbyDriverDetail.verification_badge === 'licence_only') && (
                      <span className="text-xs text-blue-600 font-medium">🛡️ DL Verified</span>
                    )}
                    {!nearbyDriverDetail.verification_badge && nearbyDriverDetail.verified && (
                      <span className="text-xs text-green-600 font-medium">✅ Verified</span>
                    )}
                    {!nearbyDriverDetail.verification_badge && !nearbyDriverDetail.verified && (
                      <span className="text-xs text-amber-600 font-medium">⏳ Pending verification</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {nearbyDriverDetail.location && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium truncate ml-4">{nearbyDriverDetail.location}</span>
                  </div>
                )}
                {nearbyDriverDetail.license_year && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Experience</span>
                    <span className="font-medium">{currentYear - nearbyDriverDetail.license_year} years</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rating</span>
                  <span><StarRating value={Math.round(nearbyDriverDetail.rating || 0)} size="sm" showValue /></span>
                </div>
              </div>

              <div className="mt-5 border-t border-border pt-4">
                <button
                  className="flex items-center justify-between w-full text-sm font-semibold text-foreground hover:text-primary transition-colors"
                  onClick={() => setShowNearbyContractForm(v => !v)}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Send Rental Contract
                  </span>
                  {showNearbyContractForm ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {showNearbyContractForm && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Use this after agreeing on terms via Messages. The driver will see the contract on their dashboard and confirm to activate the rental.
                    </p>

                    {vehicles.length === 0 ? (
                      <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                        You have no vehicles listed. Add a vehicle first to send a contract.
                      </p>
                    ) : (
                      <div>
                        <Label className="text-xs">Vehicle</Label>
                        <Select
                          value={nearbyContractForm.vehicle_id}
                          onValueChange={v => {
                            const veh = vehicles.find(x => String(x.id) === v);
                            setNearbyContractForm(f => ({
                              ...f,
                              vehicle_id:     v,
                              price_per_week: veh?.price_per_week ? String(veh.price_per_week) : f.price_per_week,
                              deposit:        veh?.deposit ? String(veh.deposit) : f.deposit,
                            }));
                          }}
                        >
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
                          <SelectContent>
                            {vehicles.map(v => (
                              <SelectItem key={v.id} value={String(v.id)}>
                                {v.make} {v.model} {v.year ? `(${v.year})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Start Date</Label>
                        <Input className="mt-1" type="date" value={nearbyContractForm.start_date} onChange={e => setNearbyContractForm(f => ({ ...f, start_date: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">End Date</Label>
                        <Input className="mt-1" type="date" value={nearbyContractForm.end_date} onChange={e => setNearbyContractForm(f => ({ ...f, end_date: e.target.value }))} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Weekly Rate (R)</Label>
                        <Input className="mt-1" type="number" min="0" placeholder="e.g. 1200" value={nearbyContractForm.price_per_week} onChange={e => setNearbyContractForm(f => ({ ...f, price_per_week: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">Deposit (R)</Label>
                        <Input className="mt-1" type="number" min="0" placeholder="e.g. 500" value={nearbyContractForm.deposit} onChange={e => setNearbyContractForm(f => ({ ...f, deposit: e.target.value }))} />
                      </div>
                    </div>

                    {nearbyContractEstimate && nearbyContractForm.price_per_week && (
                      <div className="bg-muted rounded-lg p-3 text-xs">
                        {nearbyContractEstimate.weeks} week{nearbyContractEstimate.weeks !== 1 ? 's' : ''} × R {nearbyContractForm.price_per_week} = <span className="font-bold text-foreground">R {nearbyContractEstimate.total}</span>
                        {nearbyContractForm.deposit ? <span className="text-muted-foreground"> + R {nearbyContractForm.deposit} deposit</span> : null}
                      </div>
                    )}

                    <div>
                      <Label className="text-xs">Note to Driver (optional)</Label>
                      <textarea
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                        rows={2}
                        placeholder="Any final notes or conditions agreed in your chat..."
                        value={nearbyContractForm.message}
                        onChange={e => setNearbyContractForm(f => ({ ...f, message: e.target.value }))}
                      />
                    </div>

                    <Button
                      className="w-full gap-2"
                      disabled={vehicles.length === 0}
                      onClick={handlePreviewNearbyContract}
                    >
                      <FileText className="w-4 h-4" /> Preview Contract Before Sending
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 pb-6 shrink-0">
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={() => {
                  setNearbyDriverDetail(null);
                  setShowNearbyContractForm(false);
                  navigate(`/messages?userId=${nearbyDriverDetail.id}`);
                }}
              >
                <MessageCircle className="w-4 h-4" /> Message {nearbyDriverDetail.full_name?.split(' ')[0] || 'Driver'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ImageLightbox src={nearbyDriverLightboxSrc} onClose={() => setNearbyDriverLightboxSrc(null)} />

      {/* Nearby Driver — Contract Preview Modal */}
      {showNearbyContractPreview && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center p-4 pt-8 sm:pt-4 bg-black/40 overflow-y-auto"
          onClick={() => setShowNearbyContractPreview(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl max-w-4xl w-full p-4 sm:p-6 border border-border flex flex-col max-h-[92vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1 shrink-0">
              <h2 className="text-xl font-bold">Draft & Send Contract</h2>
              <button onClick={() => setShowNearbyContractPreview(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-3 shrink-0">
              Review and edit the contract below before sending to {nearbyDriverDetail?.full_name?.split(' ')[0] || 'the driver'}. Once sent, the driver will review and accept.
            </p>

            <div className="bg-background border-2 border-primary/30 rounded-xl p-2 sm:p-3 flex-1 overflow-y-auto mb-4 min-h-0">
              <p className="text-[10px] text-primary font-medium mb-2 uppercase tracking-wide">✏️ Editable — tap to make changes</p>
              <ContractSectionsList sections={nearbyContractSections} onChange={setNearbyContractSections} />
            </div>

            <div className="flex gap-3 shrink-0">
              <Button variant="outline" className="flex-1" onClick={() => setShowNearbyContractPreview(false)}>
                Back to Edit
              </Button>
              <Button
                className="flex-1 gap-2"
                disabled={sendingNearbyContract}
                onClick={handleSendNearbyContract}
              >
                {sendingNearbyContract
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><FileText className="w-4 h-4" /> Send to {nearbyDriverDetail?.full_name?.split(' ')[0] || 'Driver'}</>}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Contract Modal — portal so AppLayout transform/overflow can't clip it */}
      {contractModal && selectedProposal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center p-4 pt-8 sm:pt-4 bg-black/40 overflow-y-auto" onClick={closeContractModal}>
          <div className="bg-card rounded-2xl shadow-xl max-w-4xl w-full p-4 sm:p-6 border border-border flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1 shrink-0">
              <h2 className="text-xl font-bold">
                {contractEditMode === 'accept' ? 'Draft & Send Contract' :
                 contractEditMode === 'edit' ? 'Edit Contract' :
                 contractEditMode === 'finalise' ? 'Confirm & Activate' :
                 'Rental Agreement'}
              </h2>
              <button onClick={closeContractModal} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            <p className="text-xs text-muted-foreground mb-3 shrink-0">
              {contractEditMode === 'review'
                ? 'Read the full agreement carefully. If you need changes, close this and discuss with the owner via Messages. Accept only when fully satisfied.'
                : contractEditMode === 'edit'
                  ? 'Edit the contract to reflect changes agreed via Messages, then save. The driver will see the updated version.'
                  : contractEditMode === 'finalise'
                    ? 'The driver has accepted this contract. Review it one final time, then confirm to activate the rental.'
                    : 'Edit the contract below — fill in all details, dates and terms. When ready, send it to the driver to review and accept.'}
            </p>

            {/* Full contract, section by section */}
            <div className={`rounded-xl p-2 sm:p-3 flex-1 overflow-y-auto mb-4 min-h-0 ${contractEditMode === 'accept' ? 'bg-background border-2 border-primary/30 ring-1 ring-primary/10' : 'bg-muted'}`}>
              {contractEditMode === 'accept' && (
                <p className="text-[10px] text-primary font-medium mb-2 uppercase tracking-wide">✏️ Editable — tap to make changes</p>
              )}
              <ContractSectionsList
                sections={contractSections}
                onChange={setContractSections}
                readOnly={contractEditMode === 'review' || contractEditMode === 'finalise'}
              />
            </div>

            {/* Checkbox only for review and finalise (driver/owner signing steps) */}
            {(contractEditMode === 'review' || contractEditMode === 'finalise') && (
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
                <Button className="flex-1" onClick={handleAcceptWithContract}>
                  Send to Driver
                </Button>
              )}
              {contractEditMode === 'edit' && (
                <Button className="flex-1" onClick={handleSaveContractEdits}>
                  Save Changes
                </Button>
              )}
              {contractEditMode === 'review' && (
                <Button className="flex-1" disabled={!contractAgreed} onClick={handleDriverConfirm}>
                  Accept Contract
                </Button>
              )}
              {contractEditMode === 'finalise' && (
                <Button className="flex-1 text-sm whitespace-nowrap" disabled={!contractAgreed} onClick={handleOwnerFinalise}>
                  <Check className="w-4 h-4 mr-1 shrink-0" /> Confirm & Activate
                </Button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Insufficient-credits prompt — shown when owner can't afford to finalise a rental */}
      <InsufficientCreditsModal
        open={showCreditsNeededModal}
        onClose={() => setShowCreditsNeededModal(false)}
        requiredAmount={200}
        actionLabel="finalise this rental agreement"
        onViewPackages={() => setShowTopUpModal(true)}
      />

      {/* Top-up / buy-credits modal */}
      {showTopUpModal && createPortal(
        <TopUpModal onClose={() => setShowTopUpModal(false)} />,
        document.body
      )}
    </div>
  );
}
