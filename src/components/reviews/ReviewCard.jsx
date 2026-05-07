import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StarRating from './StarRating';
import { format } from 'date-fns';

export default function ReviewCard({ review }) {
  return (
    <Card className="p-4 border border-border/50">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
            {(review.reviewer_name || review.reviewer_email)?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{review.reviewer_name || review.reviewer_email}</p>
            <p className="text-xs text-muted-foreground">
              {review.created_date && format(new Date(review.created_date), 'MMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StarRating value={review.rating} size="sm" />
          <Badge variant="outline" className="text-[9px] capitalize">{review.target_type}</Badge>
        </div>
      </div>
      {review.text && (
        <p className="text-sm text-muted-foreground leading-relaxed pl-10">"{review.text}"</p>
      )}
    </Card>
  );
}