// src/components/chat/RentalChatSheet.jsx
//
// The owner <-> driver chat for one rental, as a bottom sheet over Home.
// Opened from a rental card's Message button, a profile panel, or a push
// notification (/home?chat=<rentalId>). Free (migration 017).

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ContextChat from '@/components/chat/ContextChat';

export default function RentalChatSheet({ rentalId, meId, otherId, otherName, subtitle, onClose }) {
  // Close on the Android back gesture / browser Back would navigate away, so
  // just support Escape here; the X and the backdrop close it on touch.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[85vh] h-[75vh]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-4 pt-4 pb-2 shrink-0">
          <div className="min-w-0">
            <p className="font-semibold truncate">{otherName}</p>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-muted" aria-label="Close chat">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col">
          <ContextChat
            contextType="rental"
            contextId={rentalId}
            meId={meId}
            otherId={otherId}
            otherLabel={otherName}
            collapsible={false}
            maxLength={2000}
            bodyClassName="min-h-0"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
