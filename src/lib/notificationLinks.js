// src/lib/notificationLinks.js
//
// Where tapping a notification should go — used by both push taps
// (PushTapHandler) and the in-app bell (NotificationBell).
//
//   gig_offer          -> /gig-offer/:id  (the offer, with Accept)
//   any other gig_*    -> /gig/:id        (GigRedirect opens the driver's or
//                                          the customer's screen as fitting)
//   rental_message     -> /home?chat=:rentalId (opens that rental's chat)
//   message            -> /home   (legacy; there is no inbox any more)
//   payout_*           -> /earnings
//
// Returns null when a notification has no particular destination.

export function routeForNotification(type, data) {
  const gigId = data?.gig_id;
  if (type === 'gig_offer' && gigId) return `/gig-offer/${gigId}`;
  if (typeof type === 'string' && type.startsWith('gig_') && gigId) return `/gig/${gigId}`;
  if (type === 'rental_message' && data?.rental_id) return `/home?chat=${encodeURIComponent(data.rental_id)}`;
  if (type === 'message' || type === 'rental_message') return '/home';
  if (typeof type === 'string' && type.startsWith('payout_')) return '/earnings';
  return null;
}
