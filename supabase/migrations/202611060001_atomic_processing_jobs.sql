-- Serializes provider reservations by authenticated owner and job type.
-- Mutations are only available through these RPCs using the server-only service role.
alter table public.processing_jobs
  add column if not exists request_hash text,
  add column if not exists result_path text,
  add column if not exists result_payload jsonb,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists quota_charged boolean not null default true;

alter table public.garments
  add column if not exists upload_request_id uuid,
  add column if not exists upload_request_hash text;

create unique index if not exists garments_upload_request_id_uidx
  on public.garments(upload_request_id) where upload_request_id is not null;

create or replace function public.reserve_processing_job(
  p_user_id uuid,
  p_job_id uuid,
  p_job_type text,
  p_garment_id uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_limit integer;
  v_count bigint;
  v_oldest timestamptz;
  v_existing public.processing_jobs%rowtype;
  v_active public.processing_jobs%rowtype;
  v_job public.processing_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_user_id is null or p_job_id is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  v_limit := case p_job_type
    when 'background_removal' then 10
    when 'model_3d' then 3
    when 'garment_analysis' then 20
    else null
  end;
  if v_limit is null then return jsonb_build_object('outcome', 'invalid_request'); end if;

  if p_job_type = 'model_3d' then
    if p_garment_id is null or not exists (
      select 1 from public.garments g where g.id = p_garment_id and g.user_id = p_user_id
    ) then
      return jsonb_build_object('outcome', 'not_found');
    end if;
  elsif p_garment_id is not null and not exists (
    select 1 from public.garments g where g.id = p_garment_id and g.user_id = p_user_id
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Lock key, per-user quota, then per-garment generation in a stable order.
  perform pg_advisory_xact_lock(hashtextextended('processing-id:' || p_job_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('processing-quota:' || p_user_id::text || ':' || p_job_type, 0));
  if p_job_type = 'model_3d' then
    perform pg_advisory_xact_lock(hashtextextended('processing-model:' || p_user_id::text || ':' || p_garment_id::text, 0));
  end if;

  select * into v_existing from public.processing_jobs j where j.id = p_job_id for update;
  if found then
    if v_existing.user_id <> p_user_id
      or v_existing.job_type <> p_job_type
      or v_existing.garment_id is distinct from p_garment_id
      or v_existing.request_hash is distinct from p_request_hash then
      return jsonb_build_object('outcome', 'idempotency_conflict');
    end if;
    if v_existing.status in ('pending', 'processing')
      and coalesce(v_existing.lease_expires_at, v_existing.created_at + interval '30 minutes') <= now() then
      update public.processing_jobs j set status = 'failed', safe_error = 'La operación expiró antes de poder confirmar su resultado.', lease_expires_at = null
        where j.id = p_job_id and j.user_id = p_user_id returning * into v_existing;
    end if;
    return jsonb_build_object('outcome', 'existing', 'job', to_jsonb(v_existing));
  end if;

  if p_job_type = 'model_3d' then
    -- A crashed worker cannot lock a garment forever. Active polling renews the 30-minute lease.
    update public.processing_jobs j
      set status = 'failed', safe_error = 'La generación expiró antes de finalizar.', lease_expires_at = null
      where j.user_id = p_user_id and j.garment_id = p_garment_id and j.job_type = 'model_3d'
        and j.status in ('pending', 'processing')
        and coalesce(j.lease_expires_at, j.created_at + interval '24 hours') <= now();

    select * into v_active from public.processing_jobs j
      where j.user_id = p_user_id and j.garment_id = p_garment_id and j.job_type = 'model_3d'
        and j.status in ('pending', 'processing') and j.lease_expires_at > now()
      order by j.created_at asc, j.id asc limit 1 for update;
    if found then
      return jsonb_build_object('outcome', 'already_running', 'job', to_jsonb(v_active));
    end if;
  end if;

  select count(*), min(j.created_at) into v_count, v_oldest
    from public.processing_jobs j
    where j.user_id = p_user_id and j.job_type = p_job_type
      and j.quota_charged
      and j.created_at >= now() - interval '24 hours';
  if v_count >= v_limit then
    return jsonb_build_object(
      'outcome', 'daily_limit', 'limit', v_limit,
      'retry_at', v_oldest + interval '24 hours'
    );
  end if;

  insert into public.processing_jobs (id, user_id, job_type, status, garment_id, request_hash, lease_expires_at)
    values (p_job_id, p_user_id, p_job_type, 'pending', p_garment_id, p_request_hash,
      now() + case when p_job_type = 'model_3d' then interval '24 hours' else interval '30 minutes' end)
    returning * into v_job;
  return jsonb_build_object('outcome', 'reserved', 'job', to_jsonb(v_job), 'limit', v_limit);
end;
$$;

create or replace function public.update_processing_job(
  p_user_id uuid,
  p_job_id uuid,
  p_status text,
  p_provider_reference text default null,
  p_safe_error text default null,
  p_result_path text default null,
  p_result_payload jsonb default null,
  p_garment_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'processing', 'completed', 'failed', 'cancelled') then
    raise exception 'invalid processing status' using errcode = '22023';
  end if;
  if p_provider_reference is not null and length(p_provider_reference) > 500 then
    raise exception 'invalid provider reference' using errcode = '22023';
  end if;
  if p_safe_error is not null and length(p_safe_error) > 500 then
    raise exception 'invalid safe error' using errcode = '22023';
  end if;
  if p_garment_id is not null and not exists (
    select 1 from public.garments g where g.id = p_garment_id and g.user_id = p_user_id
  ) then
    raise exception 'garment not found' using errcode = 'P0002';
  end if;

  select * into v_job from public.processing_jobs j
    where j.id = p_job_id and j.user_id = p_user_id for update;
  if not found then raise exception 'processing job not found' using errcode = 'P0002'; end if;
  if p_garment_id is not null and v_job.garment_id is not null and p_garment_id <> v_job.garment_id then
    raise exception 'garment cannot be reassigned' using errcode = '22023';
  end if;
  if v_job.status in ('completed', 'failed', 'cancelled') and p_status <> v_job.status then
    raise exception 'processing job is terminal' using errcode = '22023';
  end if;

  update public.processing_jobs j set
      status = p_status,
      provider_reference = coalesce(p_provider_reference, j.provider_reference),
      safe_error = coalesce(p_safe_error, j.safe_error),
      result_path = coalesce(p_result_path, j.result_path),
      result_payload = coalesce(p_result_payload, j.result_payload),
      garment_id = coalesce(p_garment_id, j.garment_id),
      lease_expires_at = case when p_status in ('pending', 'processing')
        then now() + case when j.job_type = 'model_3d' then interval '24 hours' else interval '30 minutes' end
        else null end
    where j.id = p_job_id and j.user_id = p_user_id
    returning * into v_job;
  return to_jsonb(v_job);
end;
$$;

revoke all on function public.reserve_processing_job(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.update_processing_job(uuid, uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.reserve_processing_job(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.update_processing_job(uuid, uuid, text, text, text, text, jsonb, uuid) to service_role;

comment on function public.reserve_processing_job(uuid, uuid, text, uuid, text) is
  'Atomically reserves a user-scoped provider operation, daily quota and optional 3D garment lock. Service-role only.';
comment on function public.update_processing_job(uuid, uuid, text, text, text, text, jsonb, uuid) is
  'Updates an owned processing job from trusted server code only. Service-role only.';
