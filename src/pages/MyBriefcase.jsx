import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Briefcase, FileText, Car, Truck, Download, AlertCircle, Loader2,
} from "lucide-react";

/* ─── helpers (unchanged) ─────────────────────────────────────────────── */

function formatDate(iso) { /* … keep as before … */ }
function StatusBadge({ status }) { /* … keep as before … */ }
function Empty({ message }) { /* … keep as before … */ }
function Loading() { /* … keep as before … */ }
function downloadContractPDF(contract) { /* … keep as before … */ }

/* ─── Contracts tab (unchanged) ───────────────────────────────────────── */

function ContractsTab({ userId }) {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        setLoading(true);
        const { data } = await supabase
          .from("contracts")
          .select("*")
          .or(`driver_id.eq.${userId},owner_id.eq.${userId}`)
          .in("status", ["signed", "active", "completed"])
          .order("created_at", { ascending: false });
        setContracts(data ?? []);
      } catch (err) {
        console.error("ContractsTab error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <Loading />;
  if (error) return <Empty message={`Error loading contracts: ${error}`} />;
  if (!contracts.length) return <Empty message="No signed contracts yet." />;

  return (
    <div className="space-y-3">
      {contracts.map((c) => (
        <Card key={c.id} className="border border-border shadow-sm">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="font-medium text-sm truncate">
                    Contract #{String(c.id).slice(0, 8)}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.vehicle_type ?? "Vehicle"} · {c.vehicle_registration ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(c.start_date)} → {formatDate(c.end_date)}
                </p>
                {c.weekly_rate && (
                  <p className="text-xs font-semibold text-primary mt-1">
                    R {c.weekly_rate}/week
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="flex-shrink-0 gap-1.5 text-xs"
                onClick={() => downloadContractPDF(c)}
              >
                <Download className="w-3.5 h-3.5" />
                PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Active Rentals (driver) ────────────────────────────────────────── */

function ActiveRentalsTab({ userId }) {
  const [rentals, setRentals] = useState([]);
  const [loading, setLoading]  = useState(true);
  const [error, setError]      = useState(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        setLoading(true);
        const { data } = await supabase
          .from("rental_requests")
          .select(`
            *,
            vehicles ( make, model, registration, vehicle_type, image_url ),
            profiles!rental_requests_owner_id_fkey ( full_name, phone )
          `)
          .eq("driver_id", userId)
          .eq("status", "active")
          .order("start_date", { ascending: true });
        setRentals(data ?? []);
      } catch (err) {
        console.error("ActiveRentalsTab error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <Loading />;
  if (error) return <Empty message={`Error loading rentals: ${error}`} />;
  if (!rentals.length) return <Empty message="No active rentals right now." />;

  return (
    <div className="space-y-3">
      {rentals.map((r) => {
        const v     = r.vehicles ?? {};
        const owner = r.profiles ?? {};
        return (
          <Card key={r.id} className="border border-border shadow-sm overflow-hidden">
            {v.image_url && (
              <img src={v.image_url} alt={`${v.make} ${v.model}`}
                className="w-full h-32 object-cover" />
            )}
            <CardContent className="pt-3 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Car className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="font-medium text-sm">
                  {v.make ?? ""} {v.model ?? "Vehicle"}
                </span>
                <StatusBadge status={r.status} />
              </div>
              {v.registration && (
                <p className="text-xs text-muted-foreground">{v.registration}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDate(r.start_date)} → {formatDate(r.end_date)}
              </p>
              {r.weekly_rate && (
                <p className="text-xs font-semibold text-primary mt-1">R {r.weekly_rate}/week</p>
              )}
              {owner.full_name && (
                <p className="text-xs text-muted-foreground mt-1">
                  Owner: {owner.full_name}{owner.phone ? ` · ${owner.phone}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Active Assignments (owner) ─────────────────────────────────────── */

function ActiveAssignmentsTab({ userId }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        setLoading(true);
        const { data } = await supabase
          .from("rental_requests")
          .select(`
            *,
            vehicles ( make, model, registration, vehicle_type, image_url ),
            profiles!rental_requests_driver_id_fkey ( full_name, phone )
          `)
          .eq("owner_id", userId)
          .eq("status", "active")
          .order("start_date", { ascending: true });
        setAssignments(data ?? []);
      } catch (err) {
        console.error("ActiveAssignmentsTab error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <Loading />;
  if (error) return <Empty message={`Error loading assignments: ${error}`} />;
  if (!assignments.length) return <Empty message="No vehicles currently out on assignment." />;

  return (
    <div className="space-y-3">
      {assignments.map((a) => {
        const v      = a.vehicles ?? {};
        const driver = a.profiles ?? {};
        return (
          <Card key={a.id} className="border border-border shadow-sm overflow-hidden">
            {v.image_url && (
              <img src={v.image_url} alt={`${v.make} ${v.model}`}
                className="w-full h-32 object-cover" />
            )}
            <CardContent className="pt-3 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Truck className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="font-medium text-sm">
                  {v.make ?? ""} {v.model ?? "Vehicle"}
                </span>
                <StatusBadge status={a.status} />
              </div>
              {v.registration && (
                <p className="text-xs text-muted-foreground">{v.registration}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatDate(a.start_date)} → {formatDate(a.end_date)}
              </p>
              {a.weekly_rate && (
                <p className="text-xs font-semibold text-primary mt-1">R {a.weekly_rate}/week</p>
              )}
              {driver.full_name && (
                <p className="text-xs text-muted-foreground mt-1">
                  Driver: {driver.full_name}{driver.phone ? ` · ${driver.phone}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── My Vehicle Listings (owner) ────────────────────────────────────── */

function VehicleListingsTab({ userId }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        setLoading(true);
        const { data } = await supabase
          .from("vehicles")
          .select("*")
          .eq("owner_id", userId)
          .order("created_at", { ascending: false });
        setVehicles(data ?? []);
      } catch (err) {
        console.error("VehicleListingsTab error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <Loading />;
  if (error) return <Empty message={`Error loading vehicles: ${error}`} />;
  if (!vehicles.length) return (
    <Empty message="You have no vehicle listings yet. Add a vehicle to start earning." />
  );

  return (
    <div className="space-y-3">
      {vehicles.map((v) => (
        <Card key={v.id} className="border border-border shadow-sm overflow-hidden">
          {v.image_url && (
            <img src={v.image_url} alt={`${v.make} ${v.model}`}
              className="w-full h-32 object-cover" />
          )}
          <CardContent className="pt-3 pb-3 px-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Car className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="font-medium text-sm">
                    {v.make ?? ""} {v.model ?? "Vehicle"}
                    {v.year ? ` (${v.year})` : ""}
                  </span>
                </div>
                {v.registration && (
                  <p className="text-xs text-muted-foreground">{v.registration}</p>
                )}
                {v.vehicle_type && (
                  <p className="text-xs text-muted-foreground capitalize">{v.vehicle_type}</p>
                )}
                {v.location && (
                  <p className="text-xs text-muted-foreground mt-0.5">📍 {v.location}</p>
                )}
                {v.weekly_rate && (
                  <p className="text-xs font-semibold text-primary mt-1">R {v.weekly_rate}/week</p>
                )}
              </div>
              <StatusBadge status={v.status ?? "available"} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────── */

export default function MyBriefcase() {
  const { user } = useAuth();          // only need the auth user object
  const userId = user?.id;
  const [role, setRole] = useState(null);   // fetched from profiles
  const [roleLoading, setRoleLoading] = useState(true);

  // ── Fetch the actual role from the profiles table ──────────────────────
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();
        // Fallback to account_type if role column doesn't exist yet
        setRole(profile?.role || profile?.account_type || "driver");
      } catch (err) {
        console.error("Failed to fetch role:", err);
        setRole("driver");   // safe default
      } finally {
        setRoleLoading(false);
      }
    })();
  }, [userId]);

  // ── While role is loading, show a single spinner ──────────────────────
  if (roleLoading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary opacity-60" />
      </div>
    );
  }

  const isOwner = role === "owner" || role === "both";
  const gridCols = isOwner ? "grid-cols-3" : "grid-cols-2";

  const tabs = isOwner
    ? [
        { value: "listings",    label: "My Vehicles", icon: Car,      section: "My Vehicles",       sub: "All your listed vehicles" },
        { value: "assignments", label: "Assignments", icon: Truck,    section: "Active Assignments", sub: "Vehicles currently out on rental" },
        { value: "contracts",   label: "Contracts",   icon: FileText, section: "Signed Contracts",   sub: "Download any contract as PDF" },
      ]
    : [
        { value: "rentals",     label: "Rentals",     icon: Car,      section: "Active Rentals",     sub: "Vehicles you are currently renting" },
        { value: "contracts",   label: "Contracts",   icon: FileText, section: "Signed Contracts",   sub: "Download any contract as PDF" },
      ];

  const defaultTab = tabs[0].value;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-background border-b border-border px-4 pt-6 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <Briefcase className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold leading-tight">My Briefcase</h1>
            <p className="text-xs text-muted-foreground">
              {isOwner ? "Vehicles · Assignments · Contracts" : "Rentals · Contracts"}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4">
        <Tabs defaultValue={defaultTab}>
          <TabsList className={`w-full mb-4 grid ${gridCols} bg-muted p-1 rounded-lg`}>
            {tabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="text-xs gap-1.5 py-2">
                <Icon className="w-3.5 h-3.5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map(({ value, section, sub }) => (
            <TabsContent key={value} value={value}>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">{section}</h2>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
              {value === "contracts"   && <ContractsTab         userId={userId} />}
              {value === "rentals"     && <ActiveRentalsTab     userId={userId} />}
              {value === "assignments" && <ActiveAssignmentsTab userId={userId} />}
              {value === "listings"    && <VehicleListingsTab   userId={userId} />}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}