/**
 * InsufficientCreditsModal — the single, standard "you don't have enough
 * credits" popup used everywhere in the app. Always states the exact
 * amount needed for that specific action, and always links to the real
 * credit packages page. Don't build a bespoke version of this elsewhere —
 * import this one so the experience (and wording) stays consistent.
 *
 * Place at: src/components/credits/InsufficientCreditsModal.jsx
 *
 * Usage:
 *   <InsufficientCreditsModal
 *     open={showTopUpPrompt}
 *     onClose={() => setShowTopUpPrompt(false)}
 *     requiredAmount={200}
 *     actionLabel="finalise this rental agreement"
 *   />
 *
 * By default, the "View Credit Packages" button navigates to /credits. If a
 * page already has its own embedded purchase modal (e.g. Dashboard.jsx),
 * pass onViewPackages to open that in-place instead of navigating away.
 */
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Coins, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function InsufficientCreditsModal({ open, onClose, requiredAmount, actionLabel, onViewPackages }) {
  const navigate = useNavigate();
  if (!open) return null;

  const handleViewPackages = () => {
    onClose();
    if (onViewPackages) onViewPackages();
    else navigate('/credits');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-card rounded-2xl w-full max-w-sm shadow-xl p-6 text-center space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Coins className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="font-bold text-foreground">You've run out of credits</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {requiredAmount
              ? `You need ${requiredAmount} credits${actionLabel ? ` to ${actionLabel}` : ''}.`
              : "You need more credits to continue."}
            {' '}Top up to keep going.
          </p>
        </div>
        <Button
          onClick={handleViewPackages}
          className="w-full gap-2"
        >
          <Coins className="w-4 h-4" /> View Credit Packages
        </Button>
      </div>
    </div>,
    document.body
  );
}
