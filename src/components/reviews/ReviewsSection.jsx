import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Review } from '@/api/supabaseData';
import ReviewCard from './ReviewCard';
import StarRating from './StarRating';
import EmptyState from '@/components/common/EmptyState';

export default function ReviewsSection({ targetEmail, targetType }) {
  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['reviews', targetEmail, targetType],
    queryFn: () => Review.filter({ target_email: targetEmail, target_type: targetType }),
    enabled: !!targetEmail,
  });

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  const distribution = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviews.filter(r => r.rating === star).length,
  }));

  if (isLoading) {
    return <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {reviews.length > 0 && (
        <div className="flex items-start gap-6 p-4 bg-muted/40 rounded-xl">
          <div className="text-center">
            <p className="text-4xl font-extrabold text-foreground">{avgRating.toFixed(1)}</p>
            <StarRating value={Math.round(avgRating)} size="sm" />
            <p className="text-xs text-muted-foreground mt-1">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex-1 space-y-1">
            {distribution.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-3 text-muted-foreground">{star}</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all"
                    style={{ width: reviews.length ? `${(count / reviews.length) * 100}%` : '0%' }}
                  />
                </div>
                <span className="w-3 text-muted-foreground text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reviews.length > 0 ? (
        <div className="space-y-3">
          {reviews.map(r => <ReviewCard key={r.id} review={r} />)}
        </div>
      ) : (
        <EmptyState icon="⭐" title="No reviews yet" description="Reviews from past rentals will appear here" />
      )}
    </div>
  );
}