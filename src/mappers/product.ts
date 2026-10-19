import type { GoogleProductInput, ShopifyProduct, ShopifyVariant } from '../types';

/**
 * Maps one Shopify variant to a Merchant API ProductInput.
 *
 * Google models "one product" as one offer; Shopify models "one product"
 * as a product with multiple variants. The field mapping table in the
 * README exists because almost every field needs a decision here, not a
 * direct copy — this file is where that decision lives, with a test for
 * each one. If asked "what's the trickiest part of this integration?" the
 * honest answer is this file, not the webhook plumbing.
 *
 * `currencyCode` and `storeBaseUrl` are passed in rather than read off the
 * payload because neither is shop-level data that Shopify includes on a
 * product or inventory webhook — currency is a store setting (from
 * GET /shop.json, fetched once and cached) and the base URL is just
 * config. Pulling them in as parameters keeps this function pure and easy
 * to unit test without mocking an HTTP call.
 */
export function mapVariantToProductInput(
  product: ShopifyProduct,
  variant: ShopifyVariant,
  opts: { storeBaseUrl: string; currencyCode: string; contentLanguage: string; feedLabel: string },
): GoogleProductInput {
  const price = toAmountMicros(variant.price);
  const salePrice =
    variant.compare_at_price && Number(variant.compare_at_price) > Number(variant.price)
      ? { amountMicros: price, currencyCode: opts.currencyCode }
      : undefined;
  // Merchant API's `price` is always the non-sale price, so when there IS a
  // sale, `price` must be the compare_at (original) price and `salePrice`
  // the discounted one — not the other way around.
  const regularPrice = salePrice ? toAmountMicros(variant.compare_at_price!) : price;

  return {
    offerId: resolveOfferId(variant),
    contentLanguage: opts.contentLanguage,
    feedLabel: opts.feedLabel,
    productAttributes: {
      title: formatVariantTitle(product, variant),
      description: stripHtml(product.body_html ?? ''),
      link: buildProductLink(opts.storeBaseUrl, product.handle, variant.id),
      imageLink: resolveImageLink(product, variant),
      price: { amountMicros: regularPrice, currencyCode: opts.currencyCode },
      ...(salePrice ? { salePrice } : {}),
      availability: computeAvailability(variant),
      ...(variant.barcode ? { gtin: [variant.barcode] } : {}),
      ...(variant.sku ? { mpn: variant.sku } : {}),
      brand: product.vendor,
      itemGroupId: String(product.id),
    },
  };
}

/**
 * offerId is the identifier Google uses to recognize "this is the same
 * product as before" across inserts — change it and Merchant Center sees a
 * brand-new product (losing review history, impression history, etc.)
 * instead of an update. SKU is the natural choice since merchants treat it
 * as stable by convention, but SKU is optional in Shopify, so variants
 * without one fall back to the variant ID, which Shopify never reuses or
 * changes for the life of the variant.
 */
export function resolveOfferId(variant: ShopifyVariant): string {
  return variant.sku && variant.sku.trim().length > 0 ? variant.sku : `shopify_${variant.id}`;
}

/**
 * "Linen Shirt – Blue / M" — product title plus the variant's option
 * values. Shopify sets option1 to the literal string "Default Title" for
 * products that only have one variant and no real options; showing that to
 * a shopper on Google would be confusing, so it's filtered out.
 */
export function formatVariantTitle(product: ShopifyProduct, variant: ShopifyVariant): string {
  const options = [variant.option1, variant.option2, variant.option3].filter(
    (opt): opt is string => !!opt && opt !== 'Default Title',
  );
  return options.length > 0 ? `${product.title} – ${options.join(' / ')}` : product.title;
}

export function buildProductLink(storeBaseUrl: string, handle: string, variantId: number): string {
  const base = storeBaseUrl.replace(/\/+$/, '');
  return `${base}/products/${handle}?variant=${variantId}`;
}

/**
 * Prefers the image assigned to this specific variant (what the shopper
 * picked a color/size and expects to see); falls back to the product's
 * first image for variants with no image of their own, which is the
 * common case — most merchants only set per-variant images for the option
 * that visually differs (e.g. color).
 *
 * Throws rather than returning an empty string when there's no image at
 * all: `imageLink` is a required Merchant API field, and silently sending
 * an empty one would get the product rejected with a 400 that's much
 * harder to trace back to "this merchant has a product with no photos" than
 * failing fast here does.
 */
export function resolveImageLink(product: ShopifyProduct, variant: ShopifyVariant): string {
  const variantImage = product.images.find((img) => img.id === variant.image_id);
  if (variantImage) return variantImage.src;

  const firstProductImage = product.images[0];
  if (firstProductImage) return firstProductImage.src;

  throw new Error(
    `Product ${product.id} variant ${variant.id} has no images — cannot set imageLink`,
  );
}

/**
 * Shopify's `inventory_quantity` on the variant payload is the figure
 * Shopify itself already summed across locations (the per-location detail
 * arrives separately via inventory_levels/update and is handled in
 * localInventory.ts). `inventory_policy: 'continue'` is Shopify's "allow
 * selling when out of stock" setting, which maps to Google's `backorder`.
 */
export function computeAvailability(
  variant: Pick<ShopifyVariant, 'inventory_quantity' | 'inventory_policy'>,
): 'in_stock' | 'out_of_stock' | 'backorder' {
  if (variant.inventory_quantity > 0) return 'in_stock';
  return variant.inventory_policy === 'continue' ? 'backorder' : 'out_of_stock';
}

/**
 * Converts a Shopify decimal price string ("19.99") to Merchant API's
 * amountMicros ("19990000" = 19.99 * 1_000_000). Done with BigInt on the
 * split integer/fractional parts rather than `Math.round(Number(price) *
 * 1_000_000)` because floating-point multiplication of a decimal like 19.99
 * is not exact in binary — it's off by a fraction of a cent in a way that
 * usually rounds back correctly, but not always, and a silently-wrong price
 * sent to Google is a much worse failure mode than a thrown error on bad
 * input.
 */
export function toAmountMicros(price: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!match) {
    throw new Error(`Invalid price format: "${price}"`);
  }
  const whole = match[1]!;
  const fraction = (match[2] ?? '').slice(0, 6).padEnd(6, '0');
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction);
  return micros.toString();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
