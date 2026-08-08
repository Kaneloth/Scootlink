// src/hooks/useGigOffers.js
//
// Subscribes to this driver's personal gig-offer broadcast channel
// (driver:{id}:gig-offers — see create-gig-request.js / gig-expiry-check.js
// on the backend). Broadcast-to-all model: multiple offers can arrive
// before one is accepted or dismissed, so this holds a small queue.
//
// NOTE: I don't have visibility into your existing Realtime subscription
// pattern (referenced in your handoff notes §2 for live notifications) —
// this is written from first principles against supabase-js's standard
// broadcast API. If your existing pattern differs (e.g. a shared
// reconnect/backoff wrapper), this should be reconciled against that
// rather than left as a second, inconsistent implementation.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';

export function useGigOffers(driverId) {
  const [offers, setOffers] = useState([]);

  useEffect(() => {
    if (!driverId) return;

    const channel = supabase.channel(`driver:${driverId}:gig-offers`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'gig_offer' }, ({ payload }) => {
        setOffers((prev) => {
          // Guard against the same gig_id arriving twice (e.g. a
          // retry re-broadcast from gig-expiry-check.js before the
          // original offer was dismissed)
          if (prev.some((o) => o.gig_id === payload.gig_id)) return prev;
          return [...prev, payload];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driverId]);

  const dismissOffer = useCallback((gigId) => {
    setOffers((prev) => prev.filter((o) => o.gig_id !== gigId));
  }, []);

  return { offers, dismissOffer };
}
