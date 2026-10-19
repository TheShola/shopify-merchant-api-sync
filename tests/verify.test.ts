import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyShopifyHmac } from '../src/verify';

const SECRET = 'shhh_its_a_secret';

function sign(body: Buffer, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifyShopifyHmac', () => {
  it('accepts a signature computed with the matching secret', () => {
    const body = Buffer.from(JSON.stringify({ id: 123, title: 'Linen Shirt' }));
    const header = sign(body);

    expect(verifyShopifyHmac(body, header, SECRET)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = Buffer.from(JSON.stringify({ id: 123 }));
    const header = sign(body, 'wrong_secret');

    expect(verifyShopifyHmac(body, header, SECRET)).toBe(false);
  });

  it('rejects when the body has been tampered with after signing', () => {
    const original = Buffer.from(JSON.stringify({ id: 123, price: '10.00' }));
    const header = sign(original);
    const tampered = Buffer.from(JSON.stringify({ id: 123, price: '1.00' }));

    expect(verifyShopifyHmac(tampered, header, SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    const body = Buffer.from('{}');
    expect(verifyShopifyHmac(body, undefined, SECRET)).toBe(false);
  });

  it('rejects a header that is not valid base64-decodable content for the digest length', () => {
    const body = Buffer.from('{}');
    expect(verifyShopifyHmac(body, 'not-a-real-signature', SECRET)).toBe(false);
  });

  it('rejects an empty-string header', () => {
    const body = Buffer.from('{}');
    expect(verifyShopifyHmac(body, '', SECRET)).toBe(false);
  });
});
