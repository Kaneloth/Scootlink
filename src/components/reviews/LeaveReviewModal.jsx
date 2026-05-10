import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Star, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const StarRating = ({ value, onChange, size = 'md' }) => {
  const stars = [1, 2, 3, 4, 5];
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  return (
    <div className="flex items-center gap-1">
      {stars.map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange?.(star)}
          className={`${sizeClass} ${star <= value ? 'text-yellow-400' : 'text-gray-300'} hover:text-yellow-400 transition-colors`}
        >
          <Star className={sizeClass} fill={star <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
};

export default function LeaveReviewModal({
  open, onClose, rental, currentUser, targetEmail, targetName, targetType, targetId: propTargetId, onReviewSubmitted
}) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  // Compute the counterparty ID from the rental if the prop is missing or null
  const counterpartyId = propTargetId
    || (rental && currentUser
      ? (rental.owner_id === currentUser.id ? rental.driver_id : rental.owner_id)
      : null);

  const submitReview = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);

      if (!counterpartyId) {
        throw new Error('Could not determine who to review. Please try again later.');
      }

      // Ensure target profile exists
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: counterpartyId, email: targetEmail }, { onConflict: 'id' });
      if (profileError) throw new Error('Profile upsert failed: ' + profileError.message);

      // Insert review
      const { error: reviewError } = await supabase.from('reviews').insert([{
        rental_id: rental.id,
        reviewer_id: currentUser.id,
        target_id: counterpartyId,
        target_type: targetType,
        rating,
        comment: comment.trim() || null,
      }]);
      if (reviewError) throw new Error('Review insert failed: ' + reviewError.message);

      // Recalculate average rating
      const { data: avgData, error: avgError } = await supabase
        .from('reviews')
        .select('rating')
        .eq('target_id', counterpartyId);
      if (avgError) throw new Error('Rating calculation failed: ' + avgError.message);

      const total = avgData.reduce((sum, r) => sum + r.rating, 0);
      const newAvg = total / avgData.length;
      await supabase
        .from('profiles')
        .update({ rating: newAvg, total_reviews: avgData.length })
        .eq('id', counterpartyId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      toast.success('Review submitted!');
      onReviewSubmitted?.();
      onClose();
    },
    onError: (err) => {
      setErrorMsg(err.message);
    },
  });

  const handleSubmit = () => {
    if (rating === 0) {
      toast.error('Please select a rating');
      return;
    }
    submitReview.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rate your experience</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <Label>{targetType === 'driver' ? 'Driver' : 'Owner'}: {targetName || targetEmail}</Label>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-muted-foreground">Your Rating</span>
            <StarRating value={rating} onChange={setRating} size="lg" />
          </div>
          <div>
            <Label>Comment (optional)</Label>
            <Textarea
              placeholder="Share your experience..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitReview.isPending}>
            {submitReview.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Submit Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
