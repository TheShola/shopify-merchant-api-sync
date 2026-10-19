import type { Job } from './types';

/**
 * Dispatches a dequeued job to the right mapper + Google API client.
 *
 * Deliberately kept separate from queue.ts: the queue knows nothing about
 * Shopify or Google, only how to hold and retry jobs. This file is the one
 * place that knows "products/update means call the product mapper, then the
 * Merchant API client." That separation is what makes queue.ts testable
 * with a fake handler and this file testable by calling it directly with a
 * fake job, without either test needing to know about the other.
 *
 * TODO(mappers step): wire in src/mappers/product.ts and
 * src/clients/merchantApi.ts once they exist. For now this proves the
 * receiver -> queue -> handler path end to end and logs what it would do.
 */
export async function processJob(job: Job): Promise<void> {
  switch (job.topic) {
    case 'products/create':
    case 'products/update':
    case 'products/delete':
    case 'inventory_levels/update':
    case 'locations/update':
      // eslint-disable-next-line no-console
      console.log(`[processor] would handle ${job.topic} (webhook ${job.webhookId})`);
      await Promise.resolve();
      return;
    default: {
      // Exhaustiveness check: if WebhookTopic ever gains a member, this line
      // fails to compile until a case is added above for it.
      const _exhaustive: never = job.topic;
      throw new Error(`Unhandled webhook topic: ${String(_exhaustive)}`);
    }
  }
}
