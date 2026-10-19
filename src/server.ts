import express, { type Express, type Request, type Response } from 'express';
import { config } from './config';
import { captureRawBody, requireValidHmac } from './verify';
import { JobQueue } from './queue';
import { processJob } from './processor';
import type { Job, WebhookTopic } from './types';

const KNOWN_TOPICS: ReadonlySet<string> = new Set<WebhookTopic>([
  'products/create',
  'products/update',
  'products/delete',
  'inventory_levels/update',
  'locations/update',
]);

function isKnownTopic(topic: string): topic is WebhookTopic {
  return KNOWN_TOPICS.has(topic);
}

/**
 * Builds the Express app and wires the queue's handler, but does not start
 * listening. Split out from the bottom `if (require.main === module)` block
 * so tests can import `createApp()` and drive it with supertest against an
 * in-memory server, without a real port and without re-running this file's
 * side effects twice.
 */
export function createApp(): { app: Express; queue: JobQueue } {
  const queue = new JobQueue();
  queue.onJob(processJob);

  const app = express();

  // `verify` runs synchronously for every request body as it's parsed, which
  // is the only place a Buffer of the exact bytes received is still
  // available — req.body further down is already a parsed object. See
  // verify.ts for why the raw bytes matter.
  app.use(express.json({ verify: captureRawBody }));

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', queueSize: queue.size });
  });

  app.post(
    '/webhooks/shopify',
    requireValidHmac(config.shopify.webhookSecret),
    (req: Request, res: Response) => {
      const topic = req.get('X-Shopify-Topic');
      const webhookId = req.get('X-Shopify-Webhook-Id');
      const shopDomain = req.get('X-Shopify-Shop-Domain');

      // These headers are set by Shopify on every genuine webhook delivery.
      // Missing one past HMAC verification would mean a signed request from
      // a misconfigured source, not a forgery — still a 400, not a 401.
      if (!topic || !webhookId || !shopDomain) {
        res.status(400).json({ error: 'missing required Shopify webhook headers' });
        return;
      }

      // Shopify will add new webhook topics over time. A topic we're not
      // subscribed to in the Shopify admin shouldn't arrive here, but if one
      // does — or a topic is retired — we still want a 200 so Shopify
      // doesn't retry a request we're intentionally ignoring.
      if (!isKnownTopic(topic)) {
        res.status(200).json({ status: 'ignored', reason: 'unhandled topic' });
        return;
      }

      const job: Job = {
        webhookId,
        topic,
        shopDomain,
        payload: req.body as unknown,
        receivedAt: new Date().toISOString(),
      };

      const result = queue.enqueue(job);

      // Respond before processing finishes — Shopify expects a 200 within 5
      // seconds and will treat a timeout as a delivery failure and retry.
      // queue.enqueue() only takes the job off the HTTP thread; the actual
      // Google API calls happen asynchronously in queue.drain().
      res.status(200).json({ status: result });
    },
  );

  return { app, queue };
}

if (require.main === module) {
  const { app } = createApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Listening on port ${config.port}`);
  });
}
