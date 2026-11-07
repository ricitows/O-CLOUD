export type ProcessingType = 'background_removal' | 'model_3d' | 'garment_analysis' | 'virtual_try_on';
export type ReservationOutcome = 'reserved' | 'existing' | 'already_running' | 'daily_limit' | 'idempotency_conflict' | 'not_found' | 'invalid_request';
export type ProcessingJob = {
  id: string;
  user_id: string;
  job_type: ProcessingType;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  garment_id: string | null;
  request_hash: string | null;
  provider_reference: string | null;
  result_path: string | null;
  result_payload: Record<string, unknown> | null;
  safe_error: string | null;
  lease_expires_at: string | null;
  server_reserved_at: string | null;
  created_at: string;
};

export type Reservation = {
  outcome: ReservationOutcome;
  job?: ProcessingJob;
  limit?: number;
  retry_at?: string | null;
};

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function hashBytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashJson(value: unknown) {
  return hashBytes(new TextEncoder().encode(JSON.stringify(value)));
}

export async function reserveProcessingJob(
  client: RpcClient,
  input: { userId: string; jobId: string; jobType: ProcessingType; garmentId: string | null; requestHash: string },
): Promise<{ reservation: Reservation | null; error: unknown }> {
  const { data, error } = await client.rpc('reserve_processing_job', {
    p_user_id: input.userId,
    p_job_id: input.jobId,
    p_job_type: input.jobType,
    p_garment_id: input.garmentId,
    p_request_hash: input.requestHash,
  });
  if (error || !data || typeof data !== 'object' || !('outcome' in data)) return { reservation: null, error: error ?? new Error('Invalid reservation response') };
  return { reservation: data as Reservation, error: null };
}

export async function updateProcessingJob(
  client: RpcClient,
  input: {
    userId: string;
    jobId: string;
    status: ProcessingJob['status'];
    providerReference?: string | null;
    safeError?: string | null;
    resultPath?: string | null;
    resultPayload?: Record<string, unknown> | null;
    garmentId?: string | null;
  },
) {
  const { data, error } = await client.rpc('update_processing_job', {
    p_user_id: input.userId,
    p_job_id: input.jobId,
    p_status: input.status,
    p_provider_reference: input.providerReference ?? null,
    p_safe_error: input.safeError?.slice(0, 500) ?? null,
    p_result_path: input.resultPath ?? null,
    p_result_payload: input.resultPayload ?? null,
    p_garment_id: input.garmentId ?? null,
  });
  if (error || !data) return { job: null, error: error ?? new Error('Processing update was not persisted') };
  return { job: data as ProcessingJob, error: null };
}

export function canStartProviderCall(reservation: Reservation) {
  return reservation.outcome === 'reserved';
}

export function isTrustedProcessingJob(
  job: Pick<ProcessingJob, 'user_id' | 'job_type' | 'garment_id' | 'server_reserved_at'> | null | undefined,
  userId: string,
  jobType: ProcessingType,
  garmentId?: string | null,
): job is Pick<ProcessingJob, 'user_id' | 'job_type' | 'garment_id' | 'server_reserved_at'> {
  return Boolean(job
    && job.server_reserved_at
    && job.user_id === userId
    && job.job_type === jobType
    && (garmentId === undefined || job.garment_id === garmentId));
}

export function clipdropResultPath(userId: string, jobId: string) {
  return `${userId}/processing/${jobId}.png`;
}

export function isExpectedClipdropResultPath(job: ProcessingJob, userId: string, jobId: string) {
  return isTrustedProcessingJob(job, userId, 'background_removal', null)
    && job.id === jobId
    && job.result_path === clipdropResultPath(userId, jobId);
}
