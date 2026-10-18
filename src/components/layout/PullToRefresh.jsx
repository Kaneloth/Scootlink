// src/components/layout/PullToRefresh.jsx
//
// Pull down from the top of a page to refresh it — replaces the refresh
// buttons. Used by AppLayout as the scroll container of the main pages.
//
// Refreshing marks every cached query stale (React Query) and remounts the
// page, so pages that load their own data in an effect reload too. Only
// offered on pages without forms (enabled prop), so a pull can't wipe what
// someone is typing. Horizontal drags are left to the tab swipe.

import React, { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowDown } from 'lucide-react';

const TRIGGER = 70;   // px of (damped) pull needed to refresh
const MAX = 110;

export default function PullToRefresh({ enabled = true, className = '', style, children }) {
  const queryClient = useQueryClient();
  const scrollRef = useRef(null);
  const start = useRef(null); // { x, y, decided, pulling }
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setPull(TRIGGER * 0.7);
    try { sessionStorage.removeItem('skootlink_current_place'); } catch { /* ignore */ }
    queryClient.invalidateQueries();
    setGeneration((g) => g + 1);
    await new Promise((r) => setTimeout(r, 700));
    setRefreshing(false);
    setPull(0);
  }, [queryClient]);

  const onTouchStart = (e) => {
    if (!enabled || refreshing || e.touches.length !== 1) { start.current = null; return; }
    if ((scrollRef.current?.scrollTop ?? 0) > 0) { start.current = null; return; }
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, decided: false, pulling: false };
  };

  const onTouchMove = (e) => {
    const s = start.current;
    if (!s) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (!s.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.decided = true;
      s.pulling = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && (scrollRef.current?.scrollTop ?? 0) <= 0;
    }
    if (!s.pulling) return;
    setPull(Math.min(MAX, Math.max(0, dy * 0.5)));
  };

  const onTouchEnd = () => {
    const s = start.current;
    start.current = null;
    if (!s?.pulling) return;
    if (pull >= TRIGGER) refresh();
    else setPull(0);
  };

  const shown = pull > 4 || refreshing;
  const ready = pull >= TRIGGER;

  return (
    <div
      ref={scrollRef}
      className={`relative ${className}`}
      style={style}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {shown && (
        <div
          className="absolute left-0 right-0 flex justify-center pointer-events-none z-40"
          style={{ top: Math.max(8, pull - 36) }}
        >
          <span className="w-9 h-9 rounded-full bg-card border border-border shadow-md flex items-center justify-center text-primary">
            {refreshing
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <ArrowDown className="w-4 h-4 transition-transform" style={{ transform: ready ? 'rotate(180deg)' : 'none' }} />}
          </span>
        </div>
      )}
      <div
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: start.current?.pulling ? 'none' : 'transform 0.25s ease',
        }}
      >
        <React.Fragment key={generation}>{children}</React.Fragment>
      </div>
    </div>
  );
}
