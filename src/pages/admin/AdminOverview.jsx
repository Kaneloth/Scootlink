// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Users, FileText, Coins, ShieldCheck, Ban, Clock, UserX } from 'lucide-react';

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [
        { count: totalUsers },
        { count: bannedUsers },
        { count: suspendedUsers },
        { count: verifiedUsers },
        { count: activeRentals },
        { count: pendingRentals },
      ] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('banned', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).gt('suspended_until', new Date().toISOString()),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('id_verified', true),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);
      // Money (gig fares, listing fees, refunds, payouts): Gigs → Refunds & Payouts.

      setStats({
        totalUsers: totalUsers ?? 0,
        bannedUsers: bannedUsers ?? 0,
        suspendedUsers: suspendedUsers ?? 0,
        verifiedUsers: verifiedUsers ?? 0,
        activeRentals: activeRentals ?? 0,
        pendingRentals: pendingRentals ?? 0,
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
    { label: 'Suspended',         value: stats.suspendedUsers,   icon: UserX,       color: 'text-amber-600' },
    { label: 'Active Rentals',    value: stats.activeRentals,    icon: FileText,    color: 'text-purple-600' },
    { label: 'Pending Rentals',   value: stats.pendingRentals,   icon: Clock,       color: 'text-amber-600' },
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
