-- ============================================================
-- Skootlink — Gigs feature: admin oversight (dispute resolution, cancel)
-- Branch: feature/ride-hailing
-- Depends on: 010 (disputes, ledger), 012 (fee columns)
--
-- Called only by the admin-gigs Netlify function (service role, after its
-- admin check). Not callable by app users.
--
--   admin_resolve_gig_dispute(gig, 'release' | 'void', admin, note)
--     release: the gig completes; commission and driver payout are recorded
--              as for a confirmed gig; a 'pending' earnings-ledger entry is
--              added. The linked report is closed as 'dismissed'.
--     void:    the gig is closed as cancelled with no earnings. The linked
--              report is closed as 'resolved' (the customer's complaint stood).
--   admin_cancel_gig(gig, admin, note)
--     For a gig stuck in pending / accepted / in_progress: cancelled, no fee.
--
-- gig_requests.admin_resolution records which of these happened, so the app
-- can say "closed by Skootlink support" instead of blaming either person.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

alter table public.gig_requests
  add column if not exists admin_resolution text
    check (admin_resolution in ('released', 'voided', 'admin_cancelled'));
alter table public.gig_requests add column if not exists admin_note text;

create or replace function public.admin_resolve_gig_dispute(
  p_gig_id bigint,
  p_outcome text,
  p_admin_id uuid,
  p_note text default null
)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
  v_percent numeric;
  v_commission numeric;
  v_payout numeric;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
begin
  if p_outcome not in ('release', 'void') then
    raise exception 'Outcome must be release or void';
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found then
    raise exception 'Gig not found';
  end if;
  if v_gig.status <> 'disputed' then
    raise exception 'Only disputed gigs can be resolved';
  end if;

  if p_outcome = 'release' then
    select coalesce(gig_commission_percent, 15) into v_percent from public.app_settings where id = 1;
    v_percent := coalesce(v_percent, 15);
    v_commission := round(coalesce(v_gig.fare_amount, 0) * v_percent / 100, 2);
    v_payout := coalesce(v_gig.fare_amount, 0) - v_commission;

    update public.gig_requests
    set status = 'completed',
        completed_at = now(),
        commission_amount = v_commission,
        driver_payout_amount = v_payout,
        admin_resolution = 'released',
        admin_note = v_note,
        updated_at = now()
    where id = p_gig_id
    returning * into v_gig;

    insert into public.gig_earnings_ledger (driver_id, gig_request_id, amount, status)
    values (v_gig.driver_id, v_gig.id, v_payout, 'pending')
    on conflict (gig_request_id) do nothing;

    update public.user_reports
    set status = 'dismissed', admin_notes = coalesce(v_note, admin_notes),
        reviewed_by = p_admin_id, reviewed_at = now()
    where gig_id = p_gig_id and coalesce(status, 'pending') = 'pending';
  else
    update public.gig_requests
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = p_admin_id,
        cancellation_reason = 'Voided by Skootlink after a dispute',
        commission_amount = 0,
        driver_payout_amount = 0,
        admin_resolution = 'voided',
        admin_note = v_note,
        updated_at = now()
    where id = p_gig_id
    returning * into v_gig;

    update public.user_reports
    set status = 'resolved', admin_notes = coalesce(v_note, admin_notes),
        reviewed_by = p_admin_id, reviewed_at = now()
    where gig_id = p_gig_id and coalesce(status, 'pending') = 'pending';
  end if;

  return v_gig;
end;
$$;

create or replace function public.admin_cancel_gig(
  p_gig_id bigint,
  p_admin_id uuid,
  p_note text default null
)
returns public.gig_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gig public.gig_requests;
begin
  select * into v_gig from public.gig_requests where id = p_gig_id for update;
  if not found then
    raise exception 'Gig not found';
  end if;
  if v_gig.status not in ('pending', 'accepted', 'in_progress') then
    raise exception 'Only pending, accepted or in-progress gigs can be cancelled';
  end if;

  update public.gig_requests
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_admin_id,
      cancellation_reason = 'Cancelled by Skootlink support',
      admin_resolution = 'admin_cancelled',
      admin_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
      updated_at = now()
  where id = p_gig_id
  returning * into v_gig;

  return v_gig;
end;
$$;

revoke execute on function public.admin_resolve_gig_dispute(bigint, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_cancel_gig(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_gig_dispute(bigint, text, uuid, text) to service_role;
grant execute on function public.admin_cancel_gig(bigint, uuid, text) to service_role;

commit;

NOTIFY pgrst, 'reload schema';
