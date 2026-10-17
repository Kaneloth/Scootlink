/**
 * Netlify scheduled function: gig-document-expiry (daily, see netlify.toml)
 *
 * Runs run_gig_document_expiry() (migration 016), which:
 *   - marks vehicles whose roadworthy certificate has expired as 'expired'
 *     (no longer usable for rides),
 *   - drops Passenger-Ready drivers whose PDP has expired to Delivery-Ready,
 *   - and reminds owners/drivers 14 days before each expiry (once per date),
 * then sends each returned notification (in-app bell + push via the
 * notifications webhook).
 *
 * Like all Netlify scheduled functions, this runs on the published production
 * deploy only, never on Deploy Previews.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const handler = async () => {
  try {
    const { data: notices, error } = await supabase.rpc('run_gig_document_expiry');
    if (error) throw error;

    let sent = 0;
    for (const n of notices || []) {
      const { error: nErr } = await supabase.rpc('create_notification', {
        p_user_id: n.user_id, p_type: n.ntype, p_title: n.title, p_body: n.body, p_data: n.data || null,
      });
      if (nErr) console.error('[gig-document-expiry] notify failed:', n.ntype, n.user_id, nErr);
      else sent++;
    }

    console.log(`[gig-document-expiry] ${notices?.length || 0} change(s)/reminder(s), ${sent} notification(s) sent`);
    return { statusCode: 200, body: JSON.stringify({ processed: notices?.length || 0, sent }) };
  } catch (err) {
    console.error('[gig-document-expiry] FATAL:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
