-- Provider references are internal job metadata, never returned to public clients.
alter table public.processing_jobs
  add column if not exists provider_reference text;

alter table public.virtual_try_ons
  add column if not exists garment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'virtual_try_ons_garment_owner_fkey'
      and conrelid = 'public.virtual_try_ons'::regclass
  ) then
    alter table public.virtual_try_ons
      add constraint virtual_try_ons_garment_owner_fkey
      foreign key (garment_id, user_id)
      references public.garments(id, user_id) on delete cascade;
  end if;
end;
$$;

create index if not exists virtual_try_ons_garment_owner_idx
  on public.virtual_try_ons(user_id, garment_id, created_at desc);

create index if not exists processing_jobs_owner_kind_created_idx
  on public.processing_jobs(user_id, job_type, created_at desc);

-- GLB models are kept in the same private, owner-scoped bucket as garment images.
update storage.buckets
set file_size_limit = 36700160,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'model/gltf-binary']
where id = 'garments';
