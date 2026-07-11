/**
 * RelistButton.jsx
 * Used on vehicle cards in My Briefcase (and notification action links) for
 * vehicles approaching or past their 6-month listing expiry.
 *
 * Checks credit balance before allowing relist — if insufficient, prompts
 * the owner to top up via the existing CreditBalance purchase modal flow.
 *
 * Place at: src/components/vehicles/RelistButton.jsx
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';
import InsufficientCreditsModal from '@/components/credits/InsufficientCreditsModal';

export default function RelistButton({ vehicle, onRelisted, className = '' }) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [price, setPrice] = useState(null);

  const handleRelistClick = async () => {
    setChecking(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Please sign in again.'); return; }

      // Count OTHER vehicles (excluding this one) to determine correct tier
      const [{ data: bal }, { data: otherVehicles }] = await Promise.all([
        supabase.rpc('get_credit_balance', { p_user_id: user.id }),
        supabase.from('vehicles').select('id', { count: 'exact' }).eq('owner_id', user.id).neq('id', vehicle.id),
      ]);

      const otherCount = otherVehicles?.length ?? 0;
      const tierPrice  = otherCount === 0 ? 30 : otherCount === 1 ? 25 : 20;

      setPrice(tierPrice);

      if ((bal ?? 0) < tierPrice) {
        setShowTopUp(true);
        return;
      }

      navigate(`/edit-vehicle?id=${vehicle.id}&relist=1`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={`gap-1.5 border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 ${className}`}
        onClick={handleRelistClick}
        disabled={checking}
      >
        <RefreshCw className="w-3.5 h-3.5" /> Re-list{price ? ` (${price} cr)` : ''}
      </Button>

      <InsufficientCreditsModal
        open={showTopUp}
        onClose={() => setShowTopUp(false)}
        requiredAmount={price}
        actionLabel="re-list this vehicle"
      />
    </>
  );
}

