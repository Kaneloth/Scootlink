/**
 * useCredits — fetches and caches the current user's credit balance.
 * Exposes refetch() so components can refresh after a purchase or spend.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';

export function useCredits() {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId]   = useState(null);

  // Get user id once on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
      else setLoading(false);
    });
  }, []);

  const fetchBalance = useCallback(async (uid) => {
    if (!uid) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_credit_balance', { p_user_id: uid });
      if (!error) setBalance(data ?? 0);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (userId) fetchBalance(userId);
  }, [userId, fetchBalance]);

  const refetch = useCallback(() => {
    if (userId) fetchBalance(userId);
  }, [userId, fetchBalance]);

  return { balance, loading, refetch };
}
