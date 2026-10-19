import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildProductLink,
  computeAvailability,
  formatVariantTitle,
  mapVariantToProductInput,
  resolveImageLink,
  resolveOfferId,
  stripHtml,
  toAmountMicros,
} from '../../src/mappers/product';
import type { ShopifyProduct } from '../../src/types';

const product: ShopifyProduct = JSON.parse(
  readFileSync(path.join(__dirname, '../../samples/product-create.json'), 'utf8'),
) as ShopifyProduct;

const mapperOpts = {
  storeBaseUrl: 'https://test-store.myshopify.com',
  currencyCode: 'EUR',
  contentLanguage: 'en',
  feedLabel: 'IE',
};

describe('resolveOfferId', () => {
  it('uses the SKU when present', () => {
    expect(resolveOfferId(product.variants[0]!)).toBe('LINEN-SHIRT-BLUE-M');
  });

  it('falls back to a prefixed variant id when SKU is blank', () => {
    const variant = { ...product.variants[0]!, sku: '' };
    expect(resolveOfferId(variant)).toBe('shopify_44501923871');
  });

  it('falls back to a prefixed variant id when SKU is null', () => {
    const variant = { ...product.variants[0]!, sku: null };
    expect(resolveOfferId(variant)).toBe('shopify_44501923871');
  });
});

describe('formatVariantTitle', () => {
  it('joins non-default option values onto the product title', () => {
    expect(formatVariantTitle(product, product.variants[0]!)).toBe('Linen Shirt – Blue / M');
  });

  it('omits "Default Title" placeholder options', () => {
    const variant = { ...product.variants[0]!, option1: 'Default Title', option2: null };
    expect(formatVariantTitle(product, variant)).toBe('Linen Shirt');
  });
});

describe('buildProductLink', () => {
  it('builds a link with the variant id as a query param', () => {
    expect(buildProductLink('https://test-store.myshopify.com', 'linen-shirt', 123)).toBe(
      'https://test-store.myshopify.com/products/linen-shirt?variant=123',
    );
  });

  it('strips a trailing slash from the base URL', () => {
    expect(buildProductLink('https://test-store.myshopify.com/', 'linen-shirt', 123)).toBe(
      'https://test-store.myshopify.com/products/linen-shirt?variant=123',
    );
  });
});

describe('resolveImageLink', () => {
  it("prefers the variant's own image", () => {
    expect(resolveImageLink(product, product.variants[0]!)).toBe(
      'https://cdn.shopify.com/s/files/1/0001/0002/products/linen-shirt-blue.jpg',
    );
  });

  it("falls back to the product's first image when the variant has none", () => {
    const variant = { ...product.variants[0]!, image_id: null };
    expect(resolveImageLink(product, variant)).toBe(
      'https://cdn.shopify.com/s/files/1/0001/0002/products/linen-shirt-blue.jpg',
    );
  });

  it('throws when the product has no images at all', () => {
    const bareProduct = { ...product, images: [] };
    const variant = { ...product.variants[0]!, image_id: null };
    expect(() => resolveImageLink(bareProduct, variant)).toThrow(/no images/);
  });
});

describe('computeAvailability', () => {
  it('is in_stock when quantity is positive', () => {
    expect(computeAvailability({ inventory_quantity: 5, inventory_policy: 'deny' })).toBe(
      'in_stock',
    );
  });

  it('is backorder when out of stock but selling is allowed to continue', () => {
    expect(computeAvailability({ inventory_quantity: 0, inventory_policy: 'continue' })).toBe(
      'backorder',
    );
  });

  it('is out_of_stock when out of stock and policy denies overselling', () => {
    expect(computeAvailability({ inventory_quantity: 0, inventory_policy: 'deny' })).toBe(
      'out_of_stock',
    );
  });

  it('treats negative quantity the same as zero', () => {
    expect(computeAvailability({ inventory_quantity: -1, inventory_policy: 'deny' })).toBe(
      'out_of_stock',
    );
  });
});

describe('toAmountMicros', () => {
  it('converts a typical two-decimal price', () => {
    expect(toAmountMicros('19.99')).toBe('19990000');
  });

  it('converts a whole-number price with no decimal point', () => {
    expect(toAmountMicros('20')).toBe('20000000');
  });

  it('pads a single-decimal price', () => {
    expect(toAmountMicros('19.9')).toBe('19900000');
  });

  it('truncates beyond 6 decimal places rather than rounding', () => {
    expect(toAmountMicros('19.9999999')).toBe('19999999');
  });

  it('throws on a non-numeric string', () => {
    expect(() => toAmountMicros('abc')).toThrow(/Invalid price format/);
  });

  it('throws on a negative price', () => {
    expect(() => toAmountMicros('-5.00')).toThrow(/Invalid price format/);
  });
});

describe('stripHtml', () => {
  it('removes tags and decodes common entities', () => {
    expect(stripHtml('<p>A breathable <strong>linen</strong> shirt &amp; more</p>')).toBe(
      'A breathable linen shirt & more',
    );
  });

  it('collapses repeated whitespace left behind by removed tags', () => {
    expect(stripHtml('<p>Line one</p>\n<p>Line two</p>')).toBe('Line one Line two');
  });

  it('returns an empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('mapVariantToProductInput', () => {
  it('maps a regular-priced variant end to end', () => {
    const result = mapVariantToProductInput(product, product.variants[0]!, mapperOpts);

    expect(result.offerId).toBe('LINEN-SHIRT-BLUE-M');
    expect(result.productAttributes.title).toBe('Linen Shirt – Blue / M');
    expect(result.productAttributes.price).toEqual({ amountMicros: '59990000', currencyCode: 'EUR' });
    expect(result.productAttributes.salePrice).toBeUndefined();
    expect(result.productAttributes.availability).toBe('in_stock');
    expect(result.productAttributes.itemGroupId).toBe('8821349302');
    expect(result.productAttributes.brand).toBe('Acme Apparel Co.');
    expect(result.productAttributes.gtin).toEqual(['0012345678905']);
  });

  it('maps a sale-priced, backordered variant, putting the original price in `price`', () => {
    const result = mapVariantToProductInput(product, product.variants[1]!, mapperOpts);

    // variants[1] has price 59.99 and compare_at_price 69.99 — compare_at is
    // the pre-sale price, so it belongs in `price`, and the current lower
    // price is the `salePrice`.
    expect(result.productAttributes.price).toEqual({ amountMicros: '69990000', currencyCode: 'EUR' });
    expect(result.productAttributes.salePrice).toEqual({
      amountMicros: '59990000',
      currencyCode: 'EUR',
    });
    expect(result.productAttributes.availability).toBe('backorder');
  });

  it('omits salePrice when compare_at_price is not higher than price', () => {
    const variant = { ...product.variants[0]!, compare_at_price: '59.99' };
    const result = mapVariantToProductInput(product, variant, mapperOpts);
    expect(result.productAttributes.salePrice).toBeUndefined();
  });
});
