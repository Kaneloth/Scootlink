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
import { RefreshCw, Coins, AlertTriangle } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

const RELIST_COST = 10; // credits — same as initial listing cost

export default function RelistButton({ vehicle, onRelisted, className = '' }) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [balance, setBalance] = useState(null);

  const handleRelistClick = async () => {
    setChecking(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Please sign in again.'); return; }

      const { data: bal } = await supabase.rpc('get_credit_balance', { p_user_id: user.id });
      setBalance(bal ?? 0);

      if ((bal ?? 0) < RELIST_COST) {
        setShowTopUp(true);
        return;
      }

      // Enough credits — go straight to the edit form, prefilled with
      // existing vehicle details, with a relist flag in the URL so
      // EditVehicle.jsx knows to call relist_vehicle() on save.
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
        <RefreshCw className="w-3.5 h-3.5" /> Re-list ({RELIST_COST} cr)
      </Button>

      {showTopUp && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowTopUp(false)}>
          <div className="bg-card rounded-2xl w-full max-w-sm shadow-xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Not enough credits</p>
                <p className="text-xs text-muted-foreground">You need {RELIST_COST} credits to re-list this vehicle</p>
              </div>
            </div>

            <div className="bg-muted rounded-xl p-4 mb-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Your balance</span>
              <span className="font-bold text-foreground flex items-center gap-1">
                <Coins className="w-4 h-4 text-primary" /> {balance ?? 0} credits
              </span>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowTopUp(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => { setShowTopUp(false); navigate('/credits'); }}>
                Top Up Credits
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
