import { readFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../src/queue';
import type { Job } from '../src/types';

const DEAD_LETTER_PATH = 'dead-letter.log';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    webhookId: 'wh-1',
    topic: 'products/update',
    shopDomain: 'test-store.myshopify.com',
    payload: { id: 1 },
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(async () => {
  await rm(DEAD_LETTER_PATH, { force: true });
});

describe('JobQueue', () => {
  it('runs the registered handler for a newly enqueued job', async () => {
    const queue = new JobQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.onJob(handler);

    const result = queue.enqueue(makeJob());
    expect(result).toBe('accepted');

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ webhookId: 'wh-1' }));
  });

  it('treats a repeated webhookId as a duplicate and does not call the handler again', async () => {
    const queue = new JobQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.onJob(handler);

    expect(queue.enqueue(makeJob({ webhookId: 'wh-2' }))).toBe('accepted');
    expect(queue.enqueue(makeJob({ webhookId: 'wh-2' }))).toBe('duplicate');

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  });

  it('processes jobs in the order they were enqueued', async () => {
    const queue = new JobQueue();
    const order: string[] = [];
    queue.onJob(async (job) => {
      order.push(job.webhookId);
      await Promise.resolve();
    });

    queue.enqueue(makeJob({ webhookId: 'a' }));
    queue.enqueue(makeJob({ webhookId: 'b' }));
    queue.enqueue(makeJob({ webhookId: 'c' }));

    await vi.waitFor(() => expect(order).toEqual(['a', 'b', 'c']));
  });

  it('writes a dead-letter entry when the handler throws, and keeps draining', async () => {
    const queue = new JobQueue();
    const processed: string[] = [];
    queue.onJob(async (job) => {
      if (job.webhookId === 'bad') throw new Error('merchant API said no');
      processed.push(job.webhookId);
      await Promise.resolve();
    });

    queue.enqueue(makeJob({ webhookId: 'bad' }));
    queue.enqueue(makeJob({ webhookId: 'good' }));

    await vi.waitFor(() => expect(processed).toEqual(['good']));

    const logContents = await readFile(DEAD_LETTER_PATH, 'utf8');
    const entry = JSON.parse(logContents.trim().split('\n')[0]!) as { webhookId: string; error: string };
    expect(entry.webhookId).toBe('bad');
    expect(entry.error).toContain('merchant API said no');
  });
});
