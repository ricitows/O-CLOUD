export const TRIPO_POLL_TIMEOUT_MS = 10 * 60 * 1000;
export const TRIPO_INITIAL_POLL_DELAY_MS = 4_000;
export const TRIPO_MAX_POLL_DELAY_MS = 30_000;

export function nextTripoPollDelay(currentDelay: number) {
  return Math.min(Math.max(currentDelay * 2, TRIPO_INITIAL_POLL_DELAY_MS), TRIPO_MAX_POLL_DELAY_MS);
}

export function hasTripoPollTimedOut(startedAt: number, now = Date.now()) {
  return now - startedAt >= TRIPO_POLL_TIMEOUT_MS;
}
