import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Star, Loader2 } from 'lucide-react';
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

export default function LeaveReviewModal({ open, onClose, rental, currentUser, targetEmail, targetName, targetType }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const submitReview = useMutation({
    mutationFn: async () => {
      // 1. Fetch target user ID from email (if needed)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', targetEmail)
        .single();
      if (profileError) throw new Error('Target user not found');

      // 2. Insert review
      const { error: reviewError } = await supabase.from('reviews').insert([{
        rental_id: rental.id,
        reviewer_id: currentUser.id,
        target_id: profile.id,
        target_type: targetType,
        rating,
        comment: comment.trim() || null,
      }]);
      if (reviewError) throw reviewError;

      // 3. Update average rating on target profile
      const { data: avgData, error: avgError } = await supabase
        .from('reviews')
        .select('rating')
        .eq('target_id', profile.id);
      if (avgError) throw avgError;

      const total = avgData.reduce((sum, r) => sum + r.rating, 0);
      const newAvg = total / avgData.length;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ rating: newAvg, total_reviews: avgData.length })
        .eq('id', profile.id);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      queryClient.invalidateQueries({ queryKey: ['my-rentals'] });
      toast.success('Review submitted!');
      onClose();
    },
    onError: (err) => {
      toast.error('Failed to submit review: ' + err.message);
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
