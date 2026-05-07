import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, MapPin, User } from 'lucide-react';
import { format } from 'date-fns';

const statusColors = {
  pending: 'bg-blue-50 text-blue-700 border-blue-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-gray-50 text-gray-700 border-gray-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
};

export default function RentalCard({ rental, vehicle, counterpartyName, onTrack }) {
  return (
    <Card className="p-4 border border-border/50">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-foreground truncate">
              {vehicle?.make} {vehicle?.model}
            </h4>
            <Badge variant="outline" className={`text-[10px] ${statusColors[rental.status] || ''}`}>
              {rental.status}
            </Badge>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3" />
              {counterpartyName || 'Unknown'}
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              {rental.start_date && format(new Date(rental.start_date), 'MMM d')} – {rental.end_date && format(new Date(rental.end_date), 'MMM d, yyyy')}
            </div>
          </div>
          <p className="text-sm font-semibold mt-2">
            R {rental.price_per_week}/week
          </p>
        </div>
        {onTrack && rental.status === 'active' && (
          <Button variant="outline" size="sm" onClick={onTrack} className="shrink-0 text-xs">
            <MapPin className="w-3 h-3 mr-1" />
            Track
          </Button>
        )}
      </div>
    </Card>
  );
}