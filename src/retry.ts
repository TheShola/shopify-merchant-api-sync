/**
 * Retry wrapper for calls to the Merchant API / Business Profile API.
 *
 * The retry policy isn't one-size-fits-all across HTTP status codes, and
 * that's the point to be able to defend:
 *
 *   - 429 / 5xx  → the request probably would have worked; retry with
 *                  exponential backoff and jitter.
 *   - 400        → the request itself is wrong (bad data). Retrying sends
 *                  the exact same bad request and gets the exact same 400.
 *                  No retry — log it with enough detail to fix the data.
 *   - 401 / 403  → credentials or permissions are broken. Every other call
 *                  on this connection will fail the same way, so retrying
 *                  (or letting the next queued job try) just burns through
 *                  the backlog hitting the same wall. This is escalated to
 *                  a FatalApiError so the caller can halt instead of retry.
 *
 * Classification is based on `GoogleApiError.status`, which the API clients
 * in src/clients/ are responsible for setting from the real HTTP response.
 */

export class GoogleApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.body = body;
  }
}

/** Thrown when retries are exhausted or the error is "no-retry" after classification passes through unchanged. */
export class FatalApiError extends Error {
  // Error already declares `cause?: unknown` (ES2022), so this narrows and
  // overrides it rather than introducing a new field.
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'FatalApiError';
    this.cause = cause;
  }
}

type Classification = 'retry' | 'no-retry' | 'fatal';

function classify(status: number): Classification {
  if (status === 401 || status === 403) return 'fatal';
  if (status === 429 || status >= 500) return 'retry';
  return 'no-retry';
}

export interface RetryOptions {
  /** Total attempts including the first call. Default 5, per the README's error-handling table. */
  maxAttempts?: number;
  /** Delay before the 2nd attempt, in ms. Doubles each attempt after that. Default 1000. */
  baseDelayMs?: number;
  /** Delay is capped here before jitter is applied. Default 16000. */
  maxDelayMs?: number;
  /** Injectable for tests — real callers never need to pass this. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each wait, for logging/metrics. Not called on the final failed attempt. */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * "Full jitter" (AWS's exponential-backoff-and-jitter pattern): the delay
 * before attempt N is a random value in [0, base * 2^(N-2)], capped at
 * maxDelayMs. Picking a random delay rather than a fixed one matters when
 * many jobs fail at once (e.g. a Merchant API outage) — without jitter,
 * every job retries at exactly 1s, 2s, 4s… in lockstep and re-creates the
 * same burst of traffic it just failed on. Spreading the retries out over
 * a range avoids that synchronized "thundering herd."
 */
function computeDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const upperBound = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return Math.floor(Math.random() * upperBound);
}

/**
 * Runs `fn`, retrying on retryable Google API errors per the policy above.
 * `fn` receives the 1-indexed attempt number, mainly so logging inside it
 * can say which attempt failed.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 16000;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      // Not a classified Google API error (a network error, a bug in the
      // mapper, etc.) — we don't know enough to decide retry vs. not, so
      // surface it as-is rather than guessing.
      if (!(err instanceof GoogleApiError)) throw err;

      const classification = classify(err.status);

      if (classification === 'fatal') {
        throw new FatalApiError(
          `Google API returned ${err.status}; credentials or permissions are likely broken`,
          err,
        );
      }

      if (classification === 'no-retry') {
        throw err;
      }

      // classification === 'retry'
      if (attempt === maxAttempts) {
        throw err; // exhausted — the queue writes this to the dead-letter log
      }

      const delayMs = computeDelayMs(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.(attempt, delayMs, err);
      await sleep(delayMs);
    }
  }

  // Unreachable: the loop always returns or throws. Satisfies the compiler's
  // control-flow analysis without an `any`/`!` escape hatch.
  throw new Error('withRetry: unreachable');
}
