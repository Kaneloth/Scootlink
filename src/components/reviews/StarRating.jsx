import React from 'react';
import { Star } from 'lucide-react';

export default function StarRating({ value = 0, onChange, size = 'md', showValue = false }) {
  const sizes = { sm: 'w-3.5 h-3.5', md: 'w-5 h-5', lg: 'w-7 h-7' };
  const cls = sizes[size] || sizes.md;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(star)}
          className={onChange ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}
        >
          <Star
            className={`${cls} transition-colors ${
              star <= value
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground fill-transparent'
            }`}
          />
        </button>
      ))}
      {showValue && value > 0 && (
        <span className="text-sm font-semibold ml-1 text-foreground">{value.toFixed(1)}</span>
      )}
    </div>
  );
}