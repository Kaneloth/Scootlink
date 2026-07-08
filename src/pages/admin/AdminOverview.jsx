import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Users, FileText, Coins, ShieldCheck, Ban, Clock } from 'lucide-react';

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [
        { count: totalUsers },
        { count: bannedUsers },
        { count: verifiedUsers },
        { count: activeRentals },
        { count: pendingRentals },
        { data: ledgerRows },
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('banned', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('id_verified', true),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        // NOTE: for an MVP this pulls the ledger client-side and sums in JS.
        // If this table grows large, swap this for a small Postgres RPC that
        // does SUM(...) server-side instead of shipping every row down.
        supabase.from('credit_ledger').select('type, amount').limit(5000),
      ]);

      const purchased = (ledgerRows || [])
        .filter(r => r.type === 'purchase')
        .reduce((sum, r) => sum + (r.amount || 0), 0);
      const consumed = (ledgerRows || [])
        .filter(r => r.amount < 0)
        .reduce((sum, r) => sum + Math.abs(r.amount), 0);

      setStats({
        totalUsers: totalUsers ?? 0,
        bannedUsers: bannedUsers ?? 0,
        verifiedUsers: verifiedUsers ?? 0,
        activeRentals: activeRentals ?? 0,
        pendingRentals: pendingRentals ?? 0,
        creditsPurchased: purchased,
        creditsConsumed: consumed,
      });
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const cards = [
    { label: 'Total Users',       value: stats.totalUsers,       icon: Users,       color: 'text-blue-600' },
    { label: 'ID Verified',       value: stats.verifiedUsers,    icon: ShieldCheck, color: 'text-green-600' },
    { label: 'Banned',            value: stats.bannedUsers,      icon: Ban,         color: 'text-red-600' },
    { label: 'Active Rentals',    value: stats.activeRentals,    icon: FileText,    color: 'text-purple-600' },
    { label: 'Pending Rentals',   value: stats.pendingRentals,   icon: Clock,       color: 'text-amber-600' },
    { label: 'Credits Purchased', value: stats.creditsPurchased.toLocaleString(), icon: Coins, color: 'text-teal-600' },
    { label: 'Credits Consumed',  value: stats.creditsConsumed.toLocaleString(),  icon: Coins, color: 'text-orange-600' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Overview</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Icon className={`w-7 h-7 ${color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
