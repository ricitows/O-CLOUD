import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reserveProcessingJob, updateProcessingJob, canStartProviderCall, isTrustedProcessingJob, isExpectedClipdropResultPath } from '../supabase/functions/_shared/processing.ts';
import { garmentImagePath } from '../src/lib/images/garment-image-path.ts';
import { fallbackPick } from '../src/lib/stylist/fallback.ts';
import { hasTripoPollTimedOut, nextTripoPollDelay, TRIPO_MAX_POLL_DELAY_MS, TRIPO_POLL_TIMEOUT_MS } from '../src/lib/tripo/polling.ts';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = n => String(n).padStart(64, 'a').slice(-64);

function mockAtomicStore({ limit = 10 } = {}) {
  const jobs = new Map();
  const mutexes = new Map();
  const lock = key => {
    const previous = mutexes.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    mutexes.set(key, previous.then(() => current));
    return previous.then(() => release);
  };
  return {
    jobs,
    async rpc(name, args) {
      if (name === 'update_processing_job') {
        const job = jobs.get(args.p_job_id);
        if (!job || job.user_id !== args.p_user_id || !job.server_reserved_at) return { data: null, error: new Error('not found') };
        Object.assign(job, { status: args.p_status, provider_reference: args.p_provider_reference || job.provider_reference });
        return { data: job, error: null };
      }
      if (name !== 'reserve_processing_job') throw new Error(`Unexpected RPC ${name}`);
      const releaseId = await lock(`id:${args.p_job_id}`);
      try {
        const existing = jobs.get(args.p_job_id);
        if (existing) {
          if (existing.user_id !== args.p_user_id || existing.job_type !== args.p_job_type || existing.garment_id !== args.p_garment_id || existing.request_hash !== args.p_request_hash) {
            return { data: { outcome: 'idempotency_conflict' }, error: null };
          }
          return { data: { outcome: 'existing', job: existing }, error: null };
        }
        const releaseQuota = await lock(`quota:${args.p_user_id}:${args.p_job_type}`);
        try {
          const charged = [...jobs.values()].filter(job => job.user_id === args.p_user_id && job.job_type === args.p_job_type).length;
          if (charged >= limit) return { data: { outcome: 'daily_limit', limit, retry_at: new Date(Date.now() + 86400000).toISOString() }, error: null };
          if (args.p_job_type === 'model_3d') {
            const releaseGarment = await lock(`garment:${args.p_user_id}:${args.p_garment_id}`);
            try {
              const active = [...jobs.values()].find(job => job.user_id === args.p_user_id && job.job_type === 'model_3d' && job.garment_id === args.p_garment_id && ['pending', 'processing'].includes(job.status));
              if (active) return { data: { outcome: 'already_running', job: active }, error: null };
              const job = { id: args.p_job_id, user_id: args.p_user_id, job_type: args.p_job_type, garment_id: args.p_garment_id, request_hash: args.p_request_hash, status: 'pending', server_reserved_at: new Date().toISOString() };
              jobs.set(job.id, job);
              return { data: { outcome: 'reserved', job }, error: null };
            } finally { releaseGarment(); }
          }
          const job = { id: args.p_job_id, user_id: args.p_user_id, job_type: args.p_job_type, garment_id: args.p_garment_id, request_hash: args.p_request_hash, status: 'pending', server_reserved_at: new Date().toISOString() };
          jobs.set(job.id, job);
          return { data: { outcome: 'reserved', job }, error: null };
        } finally { releaseQuota(); }
      } finally { releaseId(); }
    },
  };
}

const reserve = (client, n, userId = uuid(1), jobType = 'background_removal', garmentId = null) => reserveProcessingJob(client, {
  userId, jobId: uuid(n), jobType, garmentId, requestHash: hash(n),
});

test('processing job update errors are surfaced to callers', async () => {
  const result = await updateProcessingJob({ rpc: async () => ({ data: null, error: new Error('database unavailable') }) }, {
    userId: uuid(1), jobId: uuid(2), status: 'processing',
  });
  assert.equal(result.job, null);
  assert.match(result.error.message, /database unavailable/);
});

test('garment upload stores the original before invoking background removal', async () => {
  const route = await readFile(new URL('../src/app/api/garments/route.ts', import.meta.url), 'utf8');
  const uploadAt = route.indexOf("storage.from('garments').upload(objectPath");
  const clipdropAt = route.indexOf("functions.invoke('remove-background'");
  assert.ok(uploadAt >= 0 && clipdropAt > uploadAt);
  assert.match(route.slice(uploadAt, clipdropAt), /if \(uploadError\)[\s\S]*return NextResponse\.json/);
});

test('concurrent reservations cannot exceed the per-user mock quota', async () => {
  const store = mockAtomicStore({ limit: 10 });
  const results = await Promise.all(Array.from({ length: 16 }, (_, index) => reserve(store, index + 1)));
  assert.equal(results.filter(result => result.reservation?.outcome === 'reserved').length, 10);
  assert.equal(results.filter(result => result.reservation?.outcome === 'daily_limit').length, 6);
});

test('concurrent 3D reservations allow only one active job per garment', async () => {
  const store = mockAtomicStore({ limit: 30 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => reserve(store, index + 1, uuid(1), 'model_3d', uuid(90))));
  assert.equal(results.filter(result => result.reservation?.outcome === 'reserved').length, 1);
  assert.equal(results.filter(result => result.reservation?.outcome === 'already_running').length, 7);
});

test('same idempotency key replays without authorizing a second provider call', async () => {
  const store = mockAtomicStore();
  const first = await reserve(store, 3);
  const replay = await reserve(store, 3);
  assert.equal(first.reservation.outcome, 'reserved');
  assert.equal(replay.reservation.outcome, 'existing');
  assert.equal(canStartProviderCall(first.reservation), true);
  assert.equal(canStartProviderCall(replay.reservation), false);
  assert.equal(store.jobs.size, 1);
});

test('another user cannot reuse an idempotency key to read or alter a job', async () => {
  const store = mockAtomicStore();
  const first = await reserve(store, 4, uuid(1));
  const misuse = await reserve(store, 4, uuid(2));
  const update = await updateProcessingJob(store, { userId: uuid(2), jobId: uuid(4), status: 'completed' });
  assert.equal(first.reservation.outcome, 'reserved');
  assert.equal(misuse.reservation.outcome, 'idempotency_conflict');
  assert.equal(update.job, null);
  assert.ok(update.error);
  assert.equal(store.jobs.get(uuid(4)).status, 'pending');
});

test('missing processed image keeps the original garment image path', () => {
  assert.equal(garmentImagePath(null, 'user-1/original.jpg'), 'user-1/original.jpg');
  assert.equal(garmentImagePath('user-1/processed.png', 'user-1/original.jpg'), 'user-1/processed.png');
});

test('JavaScript stylist fallback only returns garments from the supplied real catalog', () => {
  const catalog = [
    { id: 'top', name: 'Camisa', category: 'Parte superior', subcategory: null, color: null, is_favorite: false },
    { id: 'bottom', name: 'Pantalón', category: 'Parte inferior', subcategory: null, color: null, is_favorite: false },
    { id: 'shoes', name: 'Zapatos', category: 'Calzado', subcategory: null, color: null, is_favorite: false },
  ];
  const picks = fallbackPick(catalog, { temperature: 20, apparentTemperature: 20, precipitation: 0, code: 0, label: 'despejado' });
  assert.ok(picks.length > 0);
  assert.ok(picks.every(item => catalog.some(owned => owned.id === item.id)));
});

test('Tripo polling backs off, caps its delay, and stops after ten minutes', () => {
  let delay = 4_000;
  for (let count = 0; count < 20; count++) delay = nextTripoPollDelay(delay);
  assert.equal(delay, TRIPO_MAX_POLL_DELAY_MS);
  assert.equal(hasTripoPollTimedOut(100, 100 + TRIPO_POLL_TIMEOUT_MS), true);
  assert.equal(hasTripoPollTimedOut(100, 100 + TRIPO_POLL_TIMEOUT_MS - 1), false);
});

test('local SQL migration contains server-only atomic reservation and ownership locks', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202611060001_atomic_processing_jobs.sql', import.meta.url), 'utf8');
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /when 'background_removal' then 10/);
  assert.match(sql, /when 'model_3d' then 3/);
  assert.match(sql, /when 'garment_analysis' then 20/);
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /g\.id = p_garment_id and g\.user_id = p_user_id/);
  assert.match(sql, /grant execute on function public\.reserve_processing_job[^;]+to service_role/s);
});

test('server-only migration removes client write paths and ignores legacy untrusted rows', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202611060002_secure_processing_job_writes.sql', import.meta.url), 'utf8');
  assert.match(sql, /drop policy if exists processing_jobs_insert_own/i);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on table public\.processing_jobs from public, anon, authenticated/i);
  assert.match(sql, /server_reserved_at is null[\s\S]*idempotency_conflict/i);
  assert.match(sql, /server_reserved_at is not null[\s\S]*created_at >= now\(\) - interval '24 hours'/i);
  assert.match(sql, /when 'virtual_try_on' then 3/i);
  assert.match(sql, /p_status not in \('pending', 'processing', 'completed', 'failed', 'cancelled'\)/i);
  assert.match(sql, /not \(storage\.foldername\(name\) && array\['processing', 'models'\]::text\[\]\)/i);
  assert.match(sql, /revoke insert \(%1\$I\), update \(%1\$I\)[\s\S]*from public, anon, authenticated/i);
});

test('Clipdrop provenance requires the exact user and operation result path', async () => {
  const trusted = { id: uuid(11), user_id: uuid(1), job_type: 'background_removal', garment_id: null, status: 'completed', request_hash: hash(11), result_path: `${uuid(1)}/processing/${uuid(11)}.png`, result_payload: null, provider_reference: null, safe_error: null, lease_expires_at: null, server_reserved_at: new Date().toISOString(), created_at: new Date().toISOString() };
  assert.equal(isTrustedProcessingJob(trusted, uuid(1), 'background_removal', null), true);
  assert.equal(isExpectedClipdropResultPath(trusted, uuid(1), uuid(11)), true);
  assert.equal(isExpectedClipdropResultPath({ ...trusted, result_path: `${uuid(2)}/processing/${uuid(11)}.png` }, uuid(1), uuid(11)), false);
  assert.equal(isExpectedClipdropResultPath({ ...trusted, result_path: `${uuid(1)}/processing/${uuid(12)}.png` }, uuid(1), uuid(11)), false);
  assert.equal(isTrustedProcessingJob({ ...trusted, server_reserved_at: null }, uuid(1), 'background_removal', null), false);
  assert.equal(isTrustedProcessingJob(trusted, uuid(2), 'background_removal', null), false);
});

test('Tripo ignores untrusted provider references and FASHN keeps explicit consent on the controlled path', async () => {
  const tripo = await readFile(new URL('../supabase/functions/generate-3d/index.ts', import.meta.url), 'utf8');
  const fashn = await readFile(new URL('../src/app/api/try-on/route.ts', import.meta.url), 'utf8');
  assert.match(tripo, /not\('server_reserved_at', 'is', null\)/);
  assert.match(tripo, /isTrustedProcessingJob\(job, context\.user\.id, 'model_3d', garmentId\)/);
  assert.match(tripo, /admin\.storage\.from\('garments'\)\.upload\(modelPath/);
  assert.match(fashn, /if \(!allowPaid\)/);
  assert.match(fashn, /if \(!consent\)/);
  assert.match(fashn, /p_job_type: 'virtual_try_on'/);
  assert.doesNotMatch(fashn, /\.from\('processing_jobs'\)\.insert/);
  assert.doesNotMatch(fashn, /\.from\('processing_jobs'\)\.update/);
  assert.match(fashn, /updateProcessingJob\(admin, user\.id, job\.id/);
});
