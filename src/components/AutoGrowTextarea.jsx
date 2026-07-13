import React, { useRef, useEffect } from 'react';

/**
 * A textarea that grows to fit its content instead of scrolling internally
 * or truncating — resizes on every keystroke, and once on mount so it's
 * already sized correctly for any pre-filled value.
 */
export default function AutoGrowTextarea({ value, onChange, className = '', placeholder, ...props }) {
  const ref = useRef(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => { resize(); }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      className={`w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none overflow-hidden ${className}`}
      {...props}
    />
  );
}
