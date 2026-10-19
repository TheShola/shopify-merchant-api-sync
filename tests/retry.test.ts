import { describe, expect, it, vi } from 'vitest';
import { FatalApiError, GoogleApiError, withRetry } from '../src/retry';

/** No-op sleep so tests don't actually wait for backoff delays. */
const instantSleep = async () => Promise.resolve();

describe('withRetry', () => {
  it('returns the result immediately on success, with no retries', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { sleep: instantSleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new GoogleApiError('rate limited', 429))
      .mockRejectedValueOnce(new GoogleApiError('rate limited', 429))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { sleep: instantSleep });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on a 5xx the same as a 429', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new GoogleApiError('server error', 503))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { sleep: instantSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on a 400 without retrying', async () => {
    const err = new GoogleApiError('bad product data', 400);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws a FatalApiError on 401 without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new GoogleApiError('unauthorized', 401));

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toBeInstanceOf(FatalApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws a FatalApiError on 403 without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new GoogleApiError('forbidden', 403));

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toBeInstanceOf(FatalApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const err = new GoogleApiError('still rate limited', 429);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep, maxAttempts: 5 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('passes an unclassified (non-GoogleApiError) error straight through without retrying', async () => {
    const err = new TypeError('network error: ECONNRESET');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('computes delays within the expected exponential bounds and calls onRetry', async () => {
    const delays: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new GoogleApiError('x', 503))
      .mockRejectedValueOnce(new GoogleApiError('x', 503))
      .mockResolvedValueOnce('ok');

    await withRetry(fn, {
      sleep: instantSleep,
      baseDelayMs: 1000,
      onRetry: (_attempt, delayMs) => delays.push(delayMs),
    });

    // Full jitter: delay before attempt 2 is in [0, 1000), before attempt 3 in [0, 2000)
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThan(1000);
    expect(delays[1]).toBeGreaterThanOrEqual(0);
    expect(delays[1]).toBeLessThan(2000);
  });
});
