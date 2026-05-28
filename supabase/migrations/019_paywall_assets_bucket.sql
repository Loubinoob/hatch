-- ─── Migration 019 — Paywall Assets Storage Bucket ──────────────────────────
--
-- Creates a public Storage bucket "paywall-assets" so founders can upload
-- background images, hero images, testimonial avatars and logos directly from
-- the builder. Public read so the SDK can serve them on customer sites.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'paywall-assets',
  'paywall-assets',
  true,
  5242880,  -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do nothing;

-- RLS: any authenticated user can upload to their own account's prefix
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'paywall_assets_insert_authenticated'
  ) then
    create policy paywall_assets_insert_authenticated
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'paywall-assets');
  end if;
end $$;

-- Public read so SDK can fetch the images from end-user browsers
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'paywall_assets_select_public'
  ) then
    create policy paywall_assets_select_public
      on storage.objects for select
      to public
      using (bucket_id = 'paywall-assets');
  end if;
end $$;
