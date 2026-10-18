// src/hooks/useGigOffers.js
//
// Subscribes to this driver's personal gig-offer broadcast channel
// (driver:{id}:gig-offers — see create-gig-request.js / gig-expiry-check.js).
// Broadcast-to-all model: several offers can arrive before one is accepted or
// dismissed, so this holds a small queue.
//
// PRIVATE channel: the server broadcasts with private:true, and Supabase treats
// private and public channels with the same name as unrelated channels, so this
// MUST join with private:true too. Access is enforced by the RLS policy
// "drivers can receive own gig offers" on realtime.messages (migration 006).
// The subscribe callback logs failures — a rejected join is otherwise silent.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/api/supabaseData';

export function useGigOffers(driverId) {
  const [offers, setOffers] = useState([]);

  useEffect(() => {
    if (!driverId) return;

    let channel = null;
    let cancelled = false;

    (async () => {
      try {
        // Private channels authorize with the user's JWT
        await supabase.realtime.setAuth();
      } catch (err) {
        console.error('[useGigOffers] setAuth failed:', err);
      }
      if (cancelled) return;

      channel = supabase.channel(`driver:${driverId}:gig-offers`, {
        config: { private: true, broadcast: { self: false } },
      });

      channel
        .on('broadcast', { event: 'gig_offer' }, ({ payload }) => {
          setOffers((prev) => {
            // Same gig_id can arrive twice (retry re-broadcast from
            // gig-expiry-check.js before the first offer was dismissed)
            if (prev.some((o) => o.gig_id === payload.gig_id)) return prev;
            return [...prev, payload];
          });
        })
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[useGigOffers] subscription problem:', status, err);
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [driverId]);

  const dismissOffer = useCallback((gigId) => {
    setOffers((prev) => prev.filter((o) => o.gig_id !== gigId));
  }, []);

  return { offers, dismissOffer };
}