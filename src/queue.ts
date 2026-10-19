import { appendFile } from 'node:fs/promises';
import type { Job } from './types';

/**
 * In-memory, single-process job queue.
 *
 * This is intentionally simple and explicitly NOT production-durable: if the
 * process restarts, whatever's still in `pending` is lost. That's the right
 * tradeoff for a reference implementation and for local testing, but it's
 * the first thing called out in the README roadmap and in interviews — the
 * seam to swap in Pub/Sub or SQS is exactly the `enqueue` / `process` pair
 * below, nothing else in the codebase needs to know the queue changed.
 *
 * The de-dup set is the other thing worth defending: Shopify explicitly
 * documents at-least-once delivery, so a webhook can arrive twice. We key on
 * X-Shopify-Webhook-Id and keep a bounded history (not an ever-growing Set)
 * so a long-running process doesn't leak memory.
 */

const MAX_SEEN_IDS = 10_000;
const DEAD_LETTER_PATH = 'dead-letter.log';

export type JobHandler = (job: Job) => Promise<void>;

export type EnqueueResult = 'accepted' | 'duplicate';

export class JobQueue {
  private readonly pending: Job[] = [];
  /** Insertion-ordered set of webhook IDs we've already accepted, for O(1) membership + FIFO eviction. */
  private readonly seen = new Map<string, true>();
  private handler: JobHandler | null = null;
  private draining = false;

  /** Must be called once, before any job can be processed. */
  onJob(handler: JobHandler): void {
    this.handler = handler;
  }

  /**
   * Returns 'duplicate' without enqueueing if this webhookId was already
   * accepted. The caller (the webhook route) should respond 200 either way —
   * Shopify only cares that *a* 200 came back, not whether it was a fresh
   * job or a duplicate we silently dropped.
   */
  enqueue(job: Job): EnqueueResult {
    if (this.seen.has(job.webhookId)) {
      return 'duplicate';
    }

    this.markSeen(job.webhookId);
    this.pending.push(job);
    void this.drain(); // fire-and-forget: don't make the HTTP response wait on processing
    return 'accepted';
  }

  get size(): number {
    return this.pending.length;
  }

  private markSeen(webhookId: string): void {
    this.seen.set(webhookId, true);
    if (this.seen.size > MAX_SEEN_IDS) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  /**
   * Processes jobs one at a time, in order. Sequential-by-design: Shopify
   * can send products/update before products/create has finished for the
   * same product, and processing out of order (or in parallel) could re-add
   * a product that's mid-delete. A single worker trades throughput for
   * correctness; the retry/backoff logic in clients/*.ts is what keeps a
   * slow Google API call from stalling the queue indefinitely (each attempt
   * still has to finish or exhaust its retries before the next job starts).
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      let job: Job | undefined;
      while ((job = this.pending.shift())) {
        if (!this.handler) {
          throw new Error('JobQueue.onJob() was never called — no handler registered');
        }
        try {
          await this.handler(job);
        } catch (err) {
          await this.deadLetter(job, err);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Reached only when the handler throws after its own retries are
   * exhausted (see retry.ts), or on a non-retryable error it chose not to
   * swallow. Appends one JSON line per failure so a failed job can be
   * inspected and replayed by hand without parsing stack traces out of
   * stdout.
   */
  private async deadLetter(job: Job, err: unknown): Promise<void> {
    const entry = {
      webhookId: job.webhookId,
      topic: job.topic,
      shopDomain: job.shopDomain,
      receivedAt: job.receivedAt,
      failedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      payload: job.payload,
    };
    // eslint-disable-next-line no-console
    console.error(`[dead-letter] ${job.topic} ${job.webhookId}: ${entry.error}`);
    await appendFile(DEAD_LETTER_PATH, JSON.stringify(entry) + '\n', 'utf8');
  }
}
