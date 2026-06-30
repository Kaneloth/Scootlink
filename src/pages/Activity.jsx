/**
 * Activity.jsx — Skootlink Activity Feed
 * Replaces the Tracking page. Shows a personalised timeline of rental
 * events, contract updates, messages, and reminders for both drivers and owners.
 *
 * Place at: src/pages/Activity.jsx
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, FileText, MessageCircle, Star, Car, Check, AlertCircle, Bell, Loader2, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { supabase } from '@/api/supabaseClient';
import { auth } from '@/api/supabaseData';

// ── Activity item icon + colour by type ──────────────────────────────────────
const TYPE_META = {
  rental_proposal:   { icon: Car,           colour: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'     },
  rental_accepted:   { icon: Check,         colour: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
  rental_contract:   { icon: FileText,      colour: 'bg-primary/10 text-primary'                                            },
  driver_accepted:   { icon: Check,         colour: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
  rental_active:     { icon: Car,           colour: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
  rental_ended:      { icon: Clock,         colour: 'bg-muted text-muted-foreground'                                        },
  message:           { icon: MessageCircle, colour: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400' },
  review:            { icon: Star,          colour: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'  },
  reminder:          { icon: AlertCircle,   colour: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'  },
  notification:      { icon: Bell,          colour: 'bg-primary/10 text-primary'                                            },
};

function ActivityIcon({ type }) {
  const meta = TYPE_META[type] || TYPE_META.notification;
  const Icon = meta.icon;
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${meta.colour}`}>
      <Icon className="w-4 h-4" />
    </div>
  );
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Build activity items from rentals + notifications ─────────────────────────
function buildActivityItems(rentals, notifications, userId, accountType) {
  const items = [];

  // From notifications table
  notifications.forEach(n => {
    items.push({
      id:        `notif-${n.id}`,
      type:      n.type || 'notification',
      title:     n.title,
      body:      n.body,
      ts:        n.created_at,
      read:      n.read,
      action:    n.data?.rental_id ? { label: 'View', path: '/home' } : null,
    });
  });

  // From rentals — generate contextual items based on status and role
  rentals.forEach(r => {
    const isOwner  = r.owner_id === userId;
    const isDriver = r.driver_id === userId;
    const vehicle  = r.vehicles ? `${r.vehicles.make || ''} ${r.vehicles.model || ''}`.trim() : 'Vehicle';
    const counterparty = isOwner
      ? (r.driver_name || r.driver_email || 'Driver')
      : (r.owner_name  || r.owner_email  || 'Owner');

    if (r.status === 'pending' && isOwner) {
      items.push({
        id:    `rental-proposal-${r.id}`,
        type:  'rental_proposal',
        title: 'New Rental Proposal',
        body:  `${counterparty} sent a proposal for your ${vehicle}. Review and accept or decline.`,
        ts:    r.created_at,
        read:  false,
        action: { label: 'Review', path: '/home' },
      });
    }

    if (r.status === 'awaiting_driver_confirmation' && isDriver) {
      items.push({
        id:    `rental-contract-${r.id}`,
        type:  'rental_contract',
        title: 'Contract Awaiting Your Review',
        body:  `${counterparty} sent you a rental contract for ${vehicle}. Review and accept.`,
        ts:    r.created_at,
        read:  false,
        action: { label: 'Review', path: '/home' },
      });
    }

    if (r.status === 'driver_accepted' && isOwner) {
      items.push({
        id:    `driver-accepted-${r.id}`,
        type:  'driver_accepted',
        title: 'Driver Accepted Your Contract',
        body:  `${counterparty} accepted the contract for ${vehicle}. Confirm to activate the rental.`,
        ts:    r.created_at,
        read:  false,
        action: { label: 'Finalise', path: '/home' },
      });
    }

    if (r.status === 'active') {
      // Upcoming end date reminder
      if (r.end_date) {
        const daysLeft = Math.ceil((new Date(r.end_date) - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysLeft >= 0 && daysLeft <= 3) {
          items.push({
            id:    `reminder-end-${r.id}`,
            type:  'reminder',
            title: daysLeft === 0 ? 'Rental Ends Today' : `Rental Ends in ${daysLeft} Day${daysLeft !== 1 ? 's' : ''}`,
            body:  isDriver
              ? `Your rental of ${vehicle} ends on ${formatDate(r.end_date)}. Prepare to return it.`
              : `${counterparty}'s rental of ${vehicle} ends on ${formatDate(r.end_date)}.`,
            ts:    new Date(new Date(r.end_date).getTime() - daysLeft * 86400000).toISOString(),
            read:  true,
            action: { label: 'View Briefcase', path: '/briefcase' },
          });
        }
      }

      items.push({
        id:    `active-${r.id}`,
        type:  'rental_active',
        title: 'Active Rental',
        body:  isDriver
          ? `Your rental of ${vehicle} from ${counterparty} is active. Ends ${formatDate(r.end_date)}.`
          : `${counterparty} is renting your ${vehicle}. Ends ${formatDate(r.end_date)}.`,
        ts:    r.created_at,
        read:  true,
        action: { label: 'Briefcase', path: '/briefcase' },
      });
    }

    if (r.status === 'completed' || r.status === 'ended') {
      items.push({
        id:    `ended-${r.id}`,
        type:  'rental_ended',
        title: 'Rental Completed',
        body:  isDriver
          ? `Your rental of ${vehicle} has ended. Leave a review for ${counterparty}.`
          : `${counterparty} has returned your ${vehicle}. Leave a review.`,
        ts:    r.created_at,
        read:  true,
        action: { label: 'Leave Review', path: '/home' },
      });
    }
  });

  // Sort newest first
  items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return items;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Activity() {
  const navigate = useNavigate();
  const [user,          setUser]          = useState(null);
  const [accountType,   setAccountType]   = useState('driver');
  const [rentals,       setRentals]       = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [userId,        setUserId]        = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await auth.me();
        setUser(u);
        setAccountType(u?.account_type || 'driver');

        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) { setLoading(false); return; }
        setUserId(uid);

        // Fetch rentals (no embedded join — avoids PostgREST relationship
        // errors if the FK between rentals.vehicle_id and vehicles isn't
        // registered in the schema cache)
        const { data: rentalData, error: rentalErr } = await supabase
          .from('rentals')
          .select('id, status, created_at, start_date, end_date, vehicle_id, owner_id, driver_id, price_per_week, deposit')
          .or(`owner_id.eq.${uid},driver_id.eq.${uid}`)
          .order('created_at', { ascending: false })
          .limit(30);

        if (rentalErr) console.error('[Activity] rentals fetch error:', rentalErr);

        // Fetch vehicle details separately for the rentals we have
        let rentalsWithVehicles = rentalData || [];
        if (rentalsWithVehicles.length > 0) {
          const vehicleIds = [...new Set(rentalsWithVehicles.map(r => r.vehicle_id).filter(Boolean))];
          if (vehicleIds.length > 0) {
            const { data: vehicleData } = await supabase
              .from('vehicles')
              .select('id, make, model, year')
              .in('id', vehicleIds);
            const vehicleMap = Object.fromEntries((vehicleData || []).map(v => [v.id, v]));
            rentalsWithVehicles = rentalsWithVehicles.map(r => ({
              ...r,
              vehicles: vehicleMap[r.vehicle_id] || null,
            }));
          }
        }

        // Fetch notifications
        const { data: notifData } = await supabase
          .from('notifications')
          .select('id, type, title, body, read, created_at, data')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(30);

        setRentals(rentalsWithVehicles);
        setNotifications(notifData || []);
      } catch (err) {
        console.error('[Activity] load error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Realtime — refresh notifications live
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('activity-notifications')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, async () => {
        const { data } = await supabase
          .from('notifications')
          .select('id, type, title, body, read, created_at, data')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(30);
        setNotifications(data || []);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [userId]);

  const items = buildActivityItems(rentals, notifications, userId, accountType);
  const unreadCount = items.filter(i => !i.read).length;

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <PageHeader title="Activity" backTo="/home" />
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary opacity-60" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto pb-28">
      <PageHeader
        title="Activity"
        subtitle={unreadCount > 0 ? `${unreadCount} new update${unreadCount !== 1 ? 's' : ''}` : 'Your Skootlink timeline'}
        backTo="/home"
      />

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="font-semibold text-foreground mb-1">No activity yet</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Your rental activity, contract updates, and reminders will appear here.
          </p>
          <Button className="mt-6 gap-2" onClick={() => navigate('/home')}>
            Go to Dashboard
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <Card
              key={item.id}
              className={`p-4 border transition-colors ${!item.read ? 'border-primary/30 bg-primary/5' : 'border-border/50'}`}
            >
              <div className="flex items-start gap-3">
                <ActivityIcon type={item.type} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm leading-snug ${!item.read ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                      {item.title}
                    </p>
                    {!item.read && (
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.body}</p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-[10px] text-muted-foreground">{timeAgo(item.ts)}</p>
                    {item.action && (
                      <button
                        className="text-xs text-primary font-medium flex items-center gap-0.5 hover:underline"
                        onClick={() => navigate(item.action.path)}
                      >
                        {item.action.label} <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
