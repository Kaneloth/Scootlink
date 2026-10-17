// src/components/gigs/GigRatingCard.jsx
//
// "Rate your driver" / "Rate your customer" card shown on a completed gig.
// One rating per person per gig (enforced by submit_gig_review, migration
// 010). Uses the existing StarRating component in input mode.

import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseData';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import StarRating from '@/components/reviews/StarRating';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function GigRatingCard({ gigId, targetLabel }) {
  const [state, setState] = useState('checking'); // checking | open | done
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc('my_gig_review_exists', { p_gig_id: gigId });
      if (!alive) return;
      if (error) {
        console.error('[GigRatingCard] my_gig_review_exists failed:', error);
        setState('open'); // the server still refuses a second rating
        return;
      }
      setState(data ? 'done' : 'open');
    })();
    return () => { alive = false; };
  }, [gigId]);

  const submit = async () => {
    if (rating < 1) {
      toast.error('Tap a star to rate');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_gig_review', {
        p_gig_id: gigId,
        p_rating: rating,
        p_comment: comment.trim() || null,
      });
      if (error) {
        console.error('[GigRatingCard] submit_gig_review failed:', error);
        if (error.message?.includes('already rated')) {
          setState('done');
          return;
        }
        toast.error(error.message || 'Could not save your rating');
        return;
      }
      toast.success('Thanks for your rating');
      setState('done');
    } catch (err) {
      console.error('[GigRatingCard] submit error:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'checking') return null;

  if (state === 'done') {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-600" /> You rated this gig. Thank you.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 p-4 space-y-3">
      <p className="text-sm font-medium">Rate your {targetLabel}</p>
      <StarRating value={rating} onChange={setRating} size="lg" />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)"
        rows={2}
        maxLength={1000}
      />
      <Button className="w-full" onClick={submit} disabled={submitting}>
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Submit rating
      </Button>
    </div>
  );
}
