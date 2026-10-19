import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server';

// Must match SHOPIFY_WEBHOOK_SECRET in .env — config.ts reads it at import
// time, so tests run against whatever secret is in the environment.
const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET!;

function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64');
}

function shopifyHeaders(topic: string, webhookId: string, body: string) {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Topic': topic,
    'X-Shopify-Webhook-Id': webhookId,
    'X-Shopify-Shop-Domain': 'test-store.myshopify.com',
    'X-Shopify-Hmac-Sha256': sign(body),
  };
}

describe('POST /webhooks/shopify', () => {
  it('returns 200 and accepted for a validly signed, known-topic webhook', async () => {
    const { app } = createApp();
    const body = JSON.stringify({ id: 1, title: 'Linen Shirt' });

    const res = await request(app)
      .post('/webhooks/shopify')
      .set(shopifyHeaders('products/update', 'wh-abc', body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'accepted' });
  });

  it('returns 401 when the signature does not match', async () => {
    const { app } = createApp();
    const body = JSON.stringify({ id: 1 });

    const res = await request(app)
      .post('/webhooks/shopify')
      .set({
        'Content-Type': 'application/json',
        'X-Shopify-Topic': 'products/update',
        'X-Shopify-Webhook-Id': 'wh-bad-sig',
        'X-Shopify-Shop-Domain': 'test-store.myshopify.com',
        'X-Shopify-Hmac-Sha256': 'not-a-valid-signature==',
      })
      .send(body);

    expect(res.status).toBe(401);
  });

  it('returns duplicate (still 200) for a webhookId seen before, without erroring', async () => {
    const { app } = createApp();
    const body = JSON.stringify({ id: 2 });

    const first = await request(app)
      .post('/webhooks/shopify')
      .set(shopifyHeaders('products/create', 'wh-dup', body))
      .send(body);
    const second = await request(app)
      .post('/webhooks/shopify')
      .set(shopifyHeaders('products/create', 'wh-dup', body))
      .send(body);

    expect(first.body).toEqual({ status: 'accepted' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: 'duplicate' });
  });

  it('acknowledges with 200 but does not enqueue an unrecognized topic', async () => {
    const { app, queue } = createApp();
    const body = JSON.stringify({ id: 3 });

    const res = await request(app)
      .post('/webhooks/shopify')
      .set(shopifyHeaders('customers/create', 'wh-unknown-topic', body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ignored', reason: 'unhandled topic' });
    expect(queue.size).toBe(0);
  });

  it('returns 400 when a required Shopify header is missing', async () => {
    const { app } = createApp();
    const body = JSON.stringify({ id: 4 });

    const res = await request(app)
      .post('/webhooks/shopify')
      .set({
        'Content-Type': 'application/json',
        'X-Shopify-Webhook-Id': 'wh-no-topic',
        'X-Shopify-Shop-Domain': 'test-store.myshopify.com',
        'X-Shopify-Hmac-Sha256': sign(body),
      })
      .send(body);

    expect(res.status).toBe(400);
  });
});

describe('GET /healthz', () => {
  it('reports ok and the current queue size', async () => {
    const { app } = createApp();
    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', queueSize: 0 });
  });
});
