// src/components/home/CustomerHome.jsx
//
// Home for the 'customer' role (rides and deliveries only): the request comes
// first, then a live trip if there is one, then recent trips to repeat.

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Package, MapPin, ChevronRight, RotateCcw, Briefcase } from 'lucide-react';
import { supabase } from '@/api/supabaseData';
import HomeTopBar from './HomeTopBar';
import OpenGigCards from './OpenGigCards';
import { gigStateLabel, rand, shortDate, OPEN_GIG_STATUSES } from './gigLabels';

export default function CustomerHome({ user }) {
  const navigate = useNavigate();
  const [recent, setRecent] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadRecent = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('gig_requests')
      .select('id, gig_type, status, fare_amount, pickup_address, dropoff_address, created_at')
      .eq('customer_id', user.id)
      .not('status', 'in', `(${OPEN_GIG_STATUSES.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(4);
    if (error) console.error('[CustomerHome] recent trips failed:', error);
    setRecent(data || []);
  }, [user?.id]);

  useEffect(() => { loadRecent(); }, [loadRecent, refreshKey]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    await loadRecent();
    setRefreshing(false);
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <HomeTopBar user={user} role="customer" onRefresh={refresh} refreshing={refreshing} />

      <OpenGigCards key={refreshKey} userId={user?.id} />

      {/* Where to? */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-4 space-y-3">
        <button
          onClick={() => navigate('/request-gig?type=ride')}
          className="w-full flex items-center gap-3 px-4 py-4 rounded-xl bg-muted text-left active:scale-[0.99] transition-transform"
        >
          <MapPin className="w-5 h-5 text-primary shrink-0" />
          <span className="flex-1 text-base font-semibold text-foreground">Where to?</span>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="grid grid-cols-2 gap-3">
          <ServiceTile icon={Car} title="Ride" sub="Get a lift" onClick={() => navigate('/request-gig?type=ride')} />
          <ServiceTile icon={Package} title="Delivery" sub="Send a parcel" onClick={() => navigate('/request-gig?type=delivery')} />
        </div>
      </div>

      {/* Recent trips */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Recent trips</h2>
          <button onClick={() => navigate('/mysearch')} className="text-sm text-primary font-medium">See all</button>
        </div>
        {recent === null && (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
        )}
        {recent?.length === 0 && (
          <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-4 text-center">
            Your trips will show here.
          </p>
        )}
        <div className="space-y-2">
          {(recent || []).map((g) => (
            <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
              <button onClick={() => navigate(`/gig-status/${g.id}`)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                {g.gig_type === 'ride' ? <Car className="w-5 h-5 text-muted-foreground shrink-0" /> : <Package className="w-5 h-5 text-muted-foreground shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{g.dropoff_address || g.pickup_address}</span>
                  <span className="block text-xs text-muted-foreground">
                    {shortDate(g.created_at)} · {gigStateLabel(g, false)}{g.status === 'completed' ? ` · ${rand(g.fare_amount)}` : ''}
                  </span>
                </span>
              </button>
              <button
                onClick={() => navigate(`/request-gig?type=${g.gig_type}`)}
                className="p-2 rounded-full hover:bg-muted"
                aria-label="Request again"
                title="Request again"
              >
                <RotateCcw className="w-4 h-4 text-primary" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Earn with Skootlink */}
      <button
        onClick={() => navigate('/profile')}
        className="mt-6 w-full flex items-center gap-3 p-4 rounded-xl border border-border bg-card text-left"
      >
        <Briefcase className="w-5 h-5 text-primary shrink-0" />
        <span className="flex-1">
          <span className="block text-sm font-medium">Earn with Skootlink</span>
          <span className="block text-xs text-muted-foreground">Drive, deliver or list a vehicle: change your role in your profile</span>
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
}

function ServiceTile({ icon: Icon, title, sub, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 p-4 rounded-xl border border-border bg-background text-left active:scale-[0.98] transition-transform"
    >
      <span className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
        <Icon className="w-5 h-5 text-primary" />
      </span>
      <span>
        <span className="block font-semibold text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}
