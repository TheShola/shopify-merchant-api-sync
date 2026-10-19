import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Shopify signs the *exact bytes* it sent, before JSON parsing. body-parser /
 * express.json() parses the body into an object and — by default — throws
 * the raw bytes away. If we verify against JSON.stringify(req.body) instead,
 * differences in key order or number formatting between Shopify's serializer
 * and Node's will produce a different byte sequence and the signature check
 * will fail for perfectly legitimate requests. So we capture the raw buffer
 * during parsing and verify against that, not against the parsed object.
 */
declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

/** Pass this as the `verify` option to express.json(). */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf;
}

/**
 * Shopify sends the signature as base64(HMAC-SHA256(rawBody, clientSecret))
 * in the X-Shopify-Hmac-Sha256 header.
 *
 * We compare digests with crypto.timingSafeEqual rather than `===` so that
 * comparison time doesn't leak how many leading bytes matched — `===` on a
 * forged signature would return slightly faster the earlier the mismatch,
 * which is enough signal for a timing attack to eventually reconstruct a
 * valid signature. timingSafeEqual runs in constant time for buffers of
 * equal length instead.
 */
export function verifyShopifyHmac(
  rawBody: Buffer,
  hmacHeader: string | undefined,
  secret: string,
): boolean {
  if (!hmacHeader) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }

  // timingSafeEqual throws on mismatched lengths rather than returning false,
  // so check that first — a forged header of the wrong length is still a
  // fast, safe rejection, it just can't go through the constant-time path.
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(provided, expected);
}

/** Express middleware: 401s the request if the HMAC signature doesn't check out. */
export function requireValidHmac(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.rawBody) {
      // Means captureRawBody wasn't wired into express.json() for this route —
      // a setup bug, not a client error, so this is a 500, not a 401.
      res.status(500).json({ error: 'raw body not captured; cannot verify signature' });
      return;
    }

    const header = req.get('X-Shopify-Hmac-Sha256');
    const valid = verifyShopifyHmac(req.rawBody, header, secret);

    if (!valid) {
      res.status(401).json({ error: 'invalid webhook signature' });
      return;
    }

    next();
  };
}
