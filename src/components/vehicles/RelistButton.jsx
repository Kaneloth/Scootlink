/**
 * RelistButton.jsx
 * Used on vehicle cards in My Briefcase for listings that are ending or have
 * ended. Relisting is done on the vehicle's listing page, where the owner
 * pays the listing fee for another period (migration 021).
 *
 * Place at: src/components/vehicles/RelistButton.jsx
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

export default function RelistButton({ vehicle, className = '' }) {
  const navigate = useNavigate();
  return (
    <Button
      size="sm"
      variant="outline"
      className={`gap-1.5 border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 ${className}`}
      onClick={() => navigate(`/vehicle-listing/${vehicle.id}`)}
    >
      <RefreshCw className="w-3.5 h-3.5" />
      Relist
    </Button>
  );
}
