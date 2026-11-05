-- O-CLOÜD base de datos inicial. Ejecutar en un proyecto Supabase propio.
-- La propiedad se deriva de auth.uid(); nunca del navegador.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_path text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create table public.garments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  subcategory text,
  color text,
  attributes jsonb not null default '{}'::jsonb,
  original_path text,
  processed_path text,
  model_3d_path text,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'ready', 'failed')),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index garments_owner_created_idx on public.garments(user_id, created_at desc);
create index garments_owner_category_idx on public.garments(user_id, category, subcategory);

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  occasion text,
  season text,
  style_preferences text[] not null default '{}',
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index outfits_owner_created_idx on public.outfits(user_id, created_at desc);
create index outfits_owner_favorites_idx on public.outfits(user_id, is_favorite) where is_favorite;

create table public.outfit_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_id uuid not null,
  garment_id uuid not null,
  sort_order integer not null default 0,
  role text,
  created_at timestamptz not null default now(),
  primary key (user_id, outfit_id, garment_id),
  foreign key (outfit_id, user_id) references public.outfits(id, user_id) on delete cascade,
  foreign key (garment_id, user_id) references public.garments(id, user_id) on delete cascade
);
create index outfit_items_garment_idx on public.outfit_items(user_id, garment_id);

-- Una asignación por usuario y día evita duplicados accidentales. Se puede ampliar
-- a varias franjas horarias añadiendo un campo time_slot a la clave única.
create table public.outfit_calendar (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_id uuid not null,
  outfit_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, outfit_date),
  foreign key (outfit_id, user_id) references public.outfits(id, user_id) on delete cascade
);
create index outfit_calendar_owner_date_idx on public.outfit_calendar(user_id, outfit_date);

create table public.body_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  measurements jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  data_provenance jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null check (job_type in ('background_removal', 'garment_analysis', 'virtual_try_on', 'model_3d')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  garment_id uuid,
  safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (garment_id, user_id) references public.garments(id, user_id) on delete cascade
);
create index processing_jobs_owner_recent_idx on public.processing_jobs(user_id, created_at desc);

create table public.virtual_try_ons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_id uuid,
  provider_reference text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'deletion_requested')),
  result_path text,
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (outfit_id, user_id) references public.outfits(id, user_id) on delete cascade
);
create index virtual_try_ons_owner_recent_idx on public.virtual_try_ons(user_id, created_at desc);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger garments_set_updated_at before update on public.garments for each row execute function public.set_updated_at();
create trigger outfits_set_updated_at before update on public.outfits for each row execute function public.set_updated_at();
create trigger calendar_set_updated_at before update on public.outfit_calendar for each row execute function public.set_updated_at();
create trigger body_profiles_set_updated_at before update on public.body_profiles for each row execute function public.set_updated_at();
create trigger processing_jobs_set_updated_at before update on public.processing_jobs for each row execute function public.set_updated_at();
create trigger virtual_try_ons_set_updated_at before update on public.virtual_try_ons for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.garments enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;
alter table public.outfit_calendar enable row level security;
alter table public.body_profiles enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.virtual_try_ons enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "garments_select_own" on public.garments for select to authenticated using (user_id = (select auth.uid()));
create policy "garments_insert_own" on public.garments for insert to authenticated with check (user_id = (select auth.uid()));
create policy "garments_update_own" on public.garments for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "garments_delete_own" on public.garments for delete to authenticated using (user_id = (select auth.uid()));

create policy "outfits_select_own" on public.outfits for select to authenticated using (user_id = (select auth.uid()));
create policy "outfits_insert_own" on public.outfits for insert to authenticated with check (user_id = (select auth.uid()));
create policy "outfits_update_own" on public.outfits for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "outfits_delete_own" on public.outfits for delete to authenticated using (user_id = (select auth.uid()));

create policy "outfit_items_select_own" on public.outfit_items for select to authenticated using (user_id = (select auth.uid()));
create policy "outfit_items_insert_own" on public.outfit_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy "outfit_items_update_own" on public.outfit_items for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "outfit_items_delete_own" on public.outfit_items for delete to authenticated using (user_id = (select auth.uid()));

create policy "calendar_select_own" on public.outfit_calendar for select to authenticated using (user_id = (select auth.uid()));
create policy "calendar_insert_own" on public.outfit_calendar for insert to authenticated with check (user_id = (select auth.uid()));
create policy "calendar_update_own" on public.outfit_calendar for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "calendar_delete_own" on public.outfit_calendar for delete to authenticated using (user_id = (select auth.uid()));

create policy "body_profiles_select_own" on public.body_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "body_profiles_insert_own" on public.body_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "body_profiles_update_own" on public.body_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "body_profiles_delete_own" on public.body_profiles for delete to authenticated using (user_id = (select auth.uid()));

create policy "processing_jobs_select_own" on public.processing_jobs for select to authenticated using (user_id = (select auth.uid()));
create policy "processing_jobs_insert_own" on public.processing_jobs for insert to authenticated with check (user_id = (select auth.uid()));

create policy "virtual_try_ons_select_own" on public.virtual_try_ons for select to authenticated using (user_id = (select auth.uid()));
create policy "virtual_try_ons_insert_own" on public.virtual_try_ons for insert to authenticated with check (user_id = (select auth.uid()));
create policy "virtual_try_ons_update_own" on public.virtual_try_ons for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "virtual_try_ons_delete_own" on public.virtual_try_ons for delete to authenticated using (user_id = (select auth.uid()));

-- Buckets privados. Los objetos se guardan bajo una carpeta con el UUID del usuario.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('garments', 'garments', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('private-photos', 'private-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "garments_storage_select_own" on storage.objects for select to authenticated
using (bucket_id = 'garments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "garments_storage_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'garments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "garments_storage_update_own" on storage.objects for update to authenticated
using (bucket_id = 'garments' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'garments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "garments_storage_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'garments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "private_photos_storage_select_own" on storage.objects for select to authenticated
using (bucket_id = 'private-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "private_photos_storage_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'private-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "private_photos_storage_update_own" on storage.objects for update to authenticated
using (bucket_id = 'private-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'private-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "private_photos_storage_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'private-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
