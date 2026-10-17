// src/components/gigs/GigChat.jsx
//
// Free chat between a gig's customer and driver, shown on the trip screens
// (GigStatus and DriverActiveGig). A thin wrapper around the shared
// ContextChat (migration 014 RPCs). Open while the gig is accepted or in
// progress; afterwards read-only history.

import React from 'react';
import ContextChat from '@/components/chat/ContextChat';

export default function GigChat({ gigId, meId, otherId, otherLabel, canSend }) {
  return (
    <ContextChat
      contextType="gig"
      contextId={gigId}
      meId={meId}
      otherId={otherId}
      otherLabel={otherLabel}
      canSend={canSend}
      maxLength={1000}
    />
  );
}
