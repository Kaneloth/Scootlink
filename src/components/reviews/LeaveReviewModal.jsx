import React, { useState } from 'react';
import { Review, Vehicle } from '@/api/supabaseData';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import StarRating from './StarRating';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function LeaveReviewModal({ open, onClose, rental, currentUser, targetEmail, targetName, targetType }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');

  const submitReview = useMutation({
    mutationFn: async () => {
      if (!rating) throw new Error('Please select a rating');
      await Review.create({
        reviewer_email: currentUser.email,
        reviewer_name: currentUser.full_name || currentUser.email,
        target_email: targetEmail,
        target_type: targetType,
        rating,
        text,
        vehicle_id: rental?.vehicle_id || '',
      });

      // Update the target user's average rating
      const allReviews = await Review.filter({ target_email: targetEmail });
      const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
      if (targetType === 'vehicle' && rental?.vehicle_id) {
        await Vehicle.update(rental.vehicle_id, {
          rating: Math.round(avg * 10) / 10,
          total_reviews: allReviews.length,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      toast.success('Review submitted!');
      setRating(0);
      setText('');
      onClose();
    },
    onError: (err) => toast.error(err.message || 'Failed to submit review'),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rate {targetName || targetEmail}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-3">How would you rate your experience?</p>
            <div className="flex justify-center">
              <StarRating value={rating} onChange={setRating} size="lg" />
            </div>
            {rating > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Comment (optional)</Label>
            <Textarea
              className="mt-1"
              placeholder="Share your experience..."
              rows={3}
              value={text}
              onChange={e => setText(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submitReview.mutate()} disabled={!rating || submitReview.isPending}>
            {submitReview.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Submit Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}