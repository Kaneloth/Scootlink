-- ============================================================
-- Skootlink — Gigs feature: free gig chat (customer <-> driver)
-- Branch: feature/ride-hailing
-- Depends on: 001 (messages.context_type / context_id), 009
--
-- Rules (agreed 2026-10-17, from the planning decision "context decided by
-- where the chat is started"):
--   * Gig chat is always free and lives on the trip screens.
--   * Messages are stored in public.messages with context_type = 'gig' and
--     context_id = the gig id. The Messages tab ignores them, so a gig chat
--     never unlocks a credit-free rental chat.
--   * Sending is allowed only between the gig's customer and its driver,
--     while the gig is 'accepted' or 'in_progress'. Afterwards the chat is
--     read-only history.
--   * A user who blocked the other party can't be messaged by them.
-- The existing messages webhook still turns each new message into a push.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

create index if not exists idx_messages_gig_context
  on public.messages (context_id) where context_type = 'gig';

-- Send a gig message (the only way gig messages are written)
create or replace function public.send_gig_message(p_gig_id bigint, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gig public.gig_requests;
  v_to uuid;
  v_body text := nullif(left(trim(coalesce(p_body, '')), 1000), '');
  v_msg public.messages;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_body is null then
    raise exception 'Message is empty';
  end if;

  select * into v_gig from public.gig_requests where id = p_gig_id;
  if not found or v_gig.driver_id is null or v_uid not in (v_gig.customer_id, v_gig.driver_id) then
    raise exception 'Gig not found';
  end if;
  if v_gig.status not in ('accepted', 'in_progress') then
    raise exception 'This gig chat has ended';
  end if;

  v_to := case when v_uid = v_gig.customer_id then v_gig.driver_id else v_gig.customer_id end;

  if exists (select 1 from public.blocked_users where blocker_id = v_to and blocked_id = v_uid) then
    raise exception 'This message could not be sent';
  end if;

  insert into public.messages (sender_id, receiver_id, body, context_type, context_id)
  values (v_uid, v_to, v_body, 'gig', p_gig_id)
  returning * into v_msg;

  return v_msg;
end;
$$;

-- Read a gig's chat (customer and driver of that gig only)
create or replace function public.get_gig_messages(p_gig_id bigint)
returns setof public.messages
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.messages m
  join public.gig_requests g on g.id = m.context_id
  where m.context_type = 'gig'
    and m.context_id = p_gig_id
    and auth.uid() in (g.customer_id, g.driver_id)
  order by m.created_at asc, m.id asc;
$$;

-- Mark the other party's messages in this gig chat as read
create or replace function public.mark_gig_messages_read(p_gig_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.messages
  set read = true
  where context_type = 'gig'
    and context_id = p_gig_id
    and receiver_id = auth.uid()
    and read is not true;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.send_gig_message(bigint, text) from public, anon;
revoke execute on function public.get_gig_messages(bigint) from public, anon;
revoke execute on function public.mark_gig_messages_read(bigint) from public, anon;
grant execute on function public.send_gig_message(bigint, text) to authenticated;
grant execute on function public.get_gig_messages(bigint) to authenticated;
grant execute on function public.mark_gig_messages_read(bigint) to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
