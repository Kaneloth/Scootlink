// src/hooks/useRentalUnread.js
//
// Unread rental-chat messages for the signed-in user, per rental
// (my_unread_rental_messages, migration 017). Used by the Home tab badge and
// the Message buttons on rental cards.
//
// Refreshes on: a new message addressed to me (Realtime), a chat being read
// in this app (CHAT_READ_EVENT), and a 20s poll in case Realtime is down.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { CHAT_READ_EVENT } from '@/components/chat/ContextChat';

let instanceSeq = 0;

export default function useRentalUnread(userId) {
  const [byRental, setByRental] = useState({});
  const instanceRef = useRef(++instanceSeq);

  const refresh = useCallback(async () => {
    if (!userId) { setByRental({}); return; }
    const { data, error } = await supabase.rpc('my_unread_rental_messages');
    if (error) {
      console.error('[useRentalUnread] my_unread_rental_messages failed:', error);
      return;
    }
    const map = {};
    (data || []).forEach((row) => { map[String(row.rental_id)] = row.unread; });
    setByRental(map);
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    refresh();
    const ch = supabase
      .channel(`rental-unread-${userId}-${instanceRef.current}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${userId}` },
        (payload) => { if (payload.new?.context_type === 'rental') refresh(); })
      .subscribe();
    const onRead = () => refresh();
    window.addEventListener(CHAT_READ_EVENT, onRead);
    const t = setInterval(refresh, 20000);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener(CHAT_READ_EVENT, onRead);
      clearInterval(t);
    };
  }, [userId, refresh]);

  const total = Object.values(byRental).reduce((a, b) => a + b, 0);
  const forRental = (rentalId) => byRental[String(rentalId)] || 0;
  return { byRental, total, forRental, refresh };
}
