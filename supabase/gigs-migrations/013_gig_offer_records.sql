-- ============================================================
-- Skootlink — Gigs feature: offer records (for push-notification offers)
-- Branch: feature/ride-hailing
-- Depends on: 001, 009
--
-- Offers reach drivers in two ways: the live Realtime broadcast (app open)
-- and, from now on, a push notification (app closed). A driver who opens the
-- app from a push missed the broadcast, so the app needs to load the offer.
-- Pending gigs are private (RLS: only customer and assigned driver), so:
--   1. gig_offers records which drivers were offered which gig (written by
--      the Netlify functions with the service role).
--   2. get_gig_offer(gig) returns the offer details ONLY to a driver who was
--      actually offered that gig. Nobody else can browse pending gigs.
--
-- Runs as one transaction: if any statement fails, nothing changes.
-- ============================================================

begin;

create table if not exists public.gig_offers (
  gig_id bigint not null references public.gig_requests(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  distance_meters double precision,
  offered_at timestamp with time zone not null default now(),
  primary key (gig_id, driver_id)
);

comment on table public.gig_offers is
  'Which drivers were offered which gig (written by create-gig-request / gig-expiry-check). Read via get_gig_offer().';

create index if not exists idx_gig_offers_driver on public.gig_offers(driver_id);

-- RLS on, no client policies: only the service role writes; drivers read
-- through get_gig_offer() below.
alter table public.gig_offers enable row level security;

create or replace function public.get_gig_offer(p_gig_id bigint)
returns table (
  gig_id bigint,
  gig_type text,
  status text,
  pickup_address text,
  dropoff_address text,
  fare_amount numeric,
  distance_meters double precision,
  offered_at timestamp with time zone
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.gig_type, g.status, g.pickup_address, g.dropoff_address,
         g.fare_amount, o.distance_meters, o.offered_at
  from public.gig_offers o
  join public.gig_requests g on g.id = o.gig_id
  where o.gig_id = p_gig_id
    and o.driver_id = auth.uid();
$$;

revoke execute on function public.get_gig_offer(bigint) from public, anon;
grant execute on function public.get_gig_offer(bigint) to authenticated;

commit;

NOTIFY pgrst, 'reload schema';
