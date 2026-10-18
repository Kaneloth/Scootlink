-- ============================================================
-- Skootlink — contextual rental chat (replaces the Messages page)
-- Branch: feature/ride-hailing
-- Depends on: 001 (messages.context_type / context_id), 014 (gig chat)
--
-- Decisions (2026-10-17):
--   * Every chat belongs to a rental or a gig. Owners reach drivers by
--     sending a proposal (a rental row); the chat lives on that rental.
--   * Rental chats are free (no credits).
--   * Old untagged conversations (test data only) are not shown.
--
-- Rental chat rules: only the rental's owner and driver can read or send;
-- the receiver's blocks are respected. Messages are stored in
-- public.messages with context_type = 'rental', context_id = rental id.
-- The existing messages webhook still sends a push for each new message.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

create index if not exists idx_messages_rental_context
  on public.messages (context_id) where context_type = 'rental';

create or replace function public.send_rental_message(p_rental_id bigint, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rental record;
  v_to uuid;
  v_body text := nullif(left(trim(coalesce(p_body, '')), 2000), '');
  v_msg public.messages;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_body is null then
    raise exception 'Message is empty';
  end if;

  select id, owner_id, driver_id into v_rental from public.rentals where id = p_rental_id;
  if not found or v_rental.owner_id is null or v_rental.driver_id is null
     or v_uid not in (v_rental.owner_id, v_rental.driver_id) then
    raise exception 'Rental not found';
  end if;

  v_to := case when v_uid = v_rental.owner_id then v_rental.driver_id else v_rental.owner_id end;

  if exists (select 1 from public.blocked_users where blocker_id = v_to and blocked_id = v_uid) then
    raise exception 'This message could not be sent';
  end if;

  insert into public.messages (sender_id, receiver_id, body, rental_id, context_type, context_id)
  values (v_uid, v_to, v_body, p_rental_id, 'rental', p_rental_id)
  returning * into v_msg;

  return v_msg;
end;
$$;

create or replace function public.get_rental_messages(p_rental_id bigint)
returns setof public.messages
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.messages m
  join public.rentals r on r.id = m.context_id
  where m.context_type = 'rental'
    and m.context_id = p_rental_id
    and auth.uid() in (r.owner_id, r.driver_id)
  order by m.created_at asc, m.id asc;
$$;

create or replace function public.mark_rental_messages_read(p_rental_id bigint)
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
  where context_type = 'rental'
    and context_id = p_rental_id
    and receiver_id = auth.uid()
    and read is not true;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Unread rental messages for the signed-in user, per rental (Home badge and
-- per-rental counts on the Dashboard).
create or replace function public.my_unread_rental_messages()
returns table (rental_id bigint, unread integer)
language sql
stable
security definer
set search_path = public
as $$
  select m.context_id, count(*)::integer
  from public.messages m
  where m.context_type = 'rental'
    and m.receiver_id = auth.uid()
    and m.read is not true
    and not exists (
      select 1 from public.blocked_users b
      where b.blocker_id = auth.uid() and b.blocked_id = m.sender_id
    )
  group by m.context_id;
$$;

revoke execute on function public.send_rental_message(bigint, text) from public, anon;
revoke execute on function public.get_rental_messages(bigint) from public, anon;
revoke execute on function public.mark_rental_messages_read(bigint) from public, anon;
revoke execute on function public.my_unread_rental_messages() from public, anon;
grant execute on function public.send_rental_message(bigint, text) to authenticated;
grant execute on function public.get_rental_messages(bigint) to authenticated;
grant execute on function public.mark_rental_messages_read(bigint) to authenticated;
grant execute on function public.my_unread_rental_messages() to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
