// Short, role-aware labels for a gig's state (Home cards and the Trips list).

export const OPEN_GIG_STATUSES = ['awaiting_payment', 'pending', 'accepted', 'in_progress'];

export function gigStateLabel(g, asDriver) {
  switch (g.status) {
    case 'awaiting_payment': return asDriver ? 'Waiting for payment' : 'Waiting for your payment';
    case 'pending': return 'Finding a driver';
    case 'accepted':
      if (asDriver) return g.driver_arrived_at ? 'Waiting at pickup' : 'Head to pickup';
      return g.driver_arrived_at ? 'Your driver has arrived' : 'Driver on the way';
    case 'in_progress':
      if (g.driver_completed_at) return asDriver ? 'Waiting for confirmation' : 'Please confirm your trip';
      return 'On the way';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    case 'no_drivers_available': return 'No drivers found';
    case 'disputed': return 'Under review';
    default: return g.status;
  }
}

export const rand = (n) => (n == null ? '—' : `R ${Number(n).toFixed(2)}`);
export const shortDate = (iso) => (iso
  ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '');
