// src/lib/notificationLinks.js
//
// Where tapping a notification should go — used by both push taps
// (PushTapHandler) and the in-app bell (NotificationBell).
//
//   gig_offer          -> /gig-offer/:id  (the offer, with Accept)
//   any other gig_*    -> /gig/:id        (GigRedirect opens the driver's or
//                                          the customer's screen as fitting)
//   message            -> /messages
//
// Returns null when a notification has no particular destination.

export function routeForNotification(type, data) {
  const gigId = data?.gig_id;
  if (type === 'gig_offer' && gigId) return `/gig-offer/${gigId}`;
  if (typeof type === 'string' && type.startsWith('gig_') && gigId) return `/gig/${gigId}`;
  if (type === 'message') return '/messages';
  return null;
}
