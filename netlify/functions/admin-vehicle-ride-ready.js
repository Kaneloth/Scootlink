/**
 * Netlify Function: admin-vehicle-ride-ready
 * Admin-only approve/reject for vehicle Ride-Ready roadworthy
 * certification (see 001_gigs_schema.sql, and §5.5 checklist:
 * expiry date, VIN match, testing station accreditation).
 *
 * This function does NOT itself run the checklist — it's a human
 * admin's judgment call, same as identity verification. It just
 * records the decision.
 *
 * POST body:
 *   { action: 'list' }
 *   { action: 'review', vehicleId: string, decision: 'approve' | 'reject', rejectionReason?: string }
 * Auth: Bearer token, verified to belong to an admin (user_metadata.is_admin === true)
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function notify(userId, type, title, body, data = null) {
  try {
    await supabaseAdmin.rpc('create_notification', {
      p_user_id: userId, p_type: type, p_title: title, p_body: body, p_data: data,
    });
  } catch (err) {
    console.error('[admin-vehicle-ride-ready] notify failed:', err.message);
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing authorization token' }) };
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user || user.user_metadata?.is_admin !== true) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  try {
    if (body.action === 'list') {
      // New submissions (status pending) and renewals of Ride-Ready vehicles
      // (renewal_status pending, migration 016). A renewal is shown with the
      // NEW certificate in the usual fields, marked kind: 'renewal'.
      const { data: rows, error } = await supabaseAdmin
        .from('vehicles')
        .select('id, owner_id, make, model, year, plate, roadworthy_certificate_url, roadworthy_expiry_date, roadworthy_testing_station, ride_ready_status, renewal_status, renewal_certificate_url, renewal_expiry_date, renewal_testing_station')
        .or('ride_ready_status.eq.pending,renewal_status.eq.pending')
        .order('listed_at', { ascending: true });
      if (error) throw error;
      const pending = (rows || []).map((v) => (v.renewal_status === 'pending' && v.ride_ready_status !== 'pending'
        ? {
            ...v,
            kind: 'renewal',
            current_expiry_date: v.roadworthy_expiry_date,
            roadworthy_certificate_url: v.renewal_certificate_url,
            roadworthy_expiry_date: v.renewal_expiry_date,
            roadworthy_testing_station: v.renewal_testing_station,
          }
        : { ...v, kind: 'new' }));

      const ownerIds = [...new Set((pending || []).map(v => v.owner_id).filter(Boolean))];
      const { data: profiles } = ownerIds.length
        ? await supabaseAdmin.from('profiles').select('id, full_name, email, phone, customer_code').in('id', ownerIds)
        : { data: [] };
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      const merged = (pending || []).map(v => ({ ...v, owner: profileMap[v.owner_id] || null }));
      return { statusCode: 200, body: JSON.stringify({ vehicles: merged }) };
    }

    if (body.action === 'review') {
      const { vehicleId, decision, rejectionReason, kind } = body;
      if (!vehicleId || !['approve', 'reject'].includes(decision)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'vehicleId and a valid decision are required' }) };
      }

      const now = new Date().toISOString();
      const newStatus = decision === 'approve' ? 'approved' : 'rejected';

      let updated;
      let updateErr;
      if (kind === 'renewal') {
        // Approve: the renewal becomes the live certificate (and an expired
        // vehicle is Ride-Ready again). Reject: the current certificate stays.
        const { data: v, error: readErr } = await supabaseAdmin
          .from('vehicles')
          .select('renewal_certificate_url, renewal_expiry_date, renewal_testing_station')
          .eq('id', vehicleId)
          .eq('renewal_status', 'pending')
          .maybeSingle();
        if (readErr) throw readErr;
        if (v) {
          const patch = decision === 'approve'
            ? {
                roadworthy_certificate_url: v.renewal_certificate_url,
                roadworthy_expiry_date: v.renewal_expiry_date,
                roadworthy_testing_station: v.renewal_testing_station,
                ride_ready_status: 'approved',
                ride_ready_rejection_reason: null,
                ride_ready_verified_at: now,
                ride_ready_verified_by: user.id,
                renewal_status: null,
                renewal_certificate_url: null,
                renewal_expiry_date: null,
                renewal_testing_station: null,
                renewal_rejection_reason: null,
              }
            : { renewal_status: 'rejected', renewal_rejection_reason: rejectionReason || null };
          ({ data: updated, error: updateErr } = await supabaseAdmin
            .from('vehicles')
            .update(patch)
            .eq('id', vehicleId)
            .eq('renewal_status', 'pending')
            .select()
            .maybeSingle());
        }
      } else {
        ({ data: updated, error: updateErr } = await supabaseAdmin
          .from('vehicles')
          .update({
            ride_ready_status: newStatus,
            ride_ready_rejection_reason: decision === 'reject' ? (rejectionReason || null) : null,
            ride_ready_verified_at: decision === 'approve' ? now : null,
            ride_ready_verified_by: user.id,
          })
          .eq('id', vehicleId)
          .eq('ride_ready_status', 'pending')
          .select()
          .maybeSingle());
      }

      if (updateErr) throw updateErr;
      if (!updated) {
        return { statusCode: 409, body: JSON.stringify({ error: 'This vehicle was already reviewed (or is not pending).' }) };
      }

      if (decision === 'approve') {
        await notify(
          updated.owner_id, 'vehicle_ride_ready_approved',
          'Vehicle is now Ride-Ready',
          `Your ${updated.make} ${updated.model} is approved for passenger-transport gigs.`,
          { vehicle_id: updated.id },
        );
      } else {
        await notify(
          updated.owner_id, 'vehicle_ride_ready_rejected',
          kind === 'renewal' ? 'New roadworthy certificate not approved' : 'Ride-Ready certification not approved',
          (rejectionReason || `Your ${updated.make} ${updated.model}'s roadworthy certificate was not approved. Please review and resubmit.`)
            + (kind === 'renewal' && updated.ride_ready_status === 'approved' ? ' Your current certificate remains valid until it expires.' : ''),
          { vehicle_id: updated.id },
        );
      }

      console.log(`[admin-vehicle-ride-ready] ${newStatus}: vehicle=${vehicleId} owner=${updated.owner_id} admin=${user.id}`);
      return { statusCode: 200, body: JSON.stringify({ vehicle: updated }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('[admin-vehicle-ride-ready] Error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal error' }) };
  }
};
