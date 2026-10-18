-- ============================================================
-- Skootlink — Gigs feature: storage bucket policies
-- Branch: feature/ride-hailing
--
-- Buckets must be created via Supabase dashboard first ("+ New bucket"):
--   - gig-verification-documents   (NOT public)
--   - vehicle-ride-ready-documents (NOT public)
--
-- Admin-read policy confirmed working, copied exactly from
-- identity-documents' live "admin can read all" policy (pasted by user):
--   profiles.is_admin = true via EXISTS subquery.
--
-- "Users can upload/read own" policies are NOT confirmed against the
-- real identity-documents ones — only the admin policy was actually
-- shown. Using the standard Supabase convention for user-owned folders
-- (first path segment = auth.uid()). VERIFY this matches
-- "identity docs: users can upload own" / "...read own" and adjust if
-- the real path convention differs (e.g. if it's driver_id-in-filename
-- rather than a folder prefix).
-- ============================================================

-- ── gig-verification-documents ────────────────────────────────────────────
create policy "gig docs: users can upload own"
  on storage.objects for insert
  with check (
    bucket_id = 'gig-verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "gig docs: users can read own"
  on storage.objects for select
  using (
    bucket_id = 'gig-verification-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "gig docs: admin can read all"
  on storage.objects for select
  using (
    bucket_id = 'gig-verification-documents'
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

-- ── vehicle-ride-ready-documents ──────────────────────────────────────────
create policy "ride-ready docs: owners can upload own"
  on storage.objects for insert
  with check (
    bucket_id = 'vehicle-ride-ready-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "ride-ready docs: owners can read own"
  on storage.objects for select
  using (
    bucket_id = 'vehicle-ride-ready-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "ride-ready docs: admin can read all"
  on storage.objects for select
  using (
    bucket_id = 'vehicle-ride-ready-documents'
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );
