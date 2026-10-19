/**
 * Shared types for the sync service.
 *
 * Shopify payload types here are intentionally narrow: only the fields this
 * service actually reads. Shopify's real payloads carry far more — modeling
 * the whole thing would mean maintaining a schema nobody uses. If a mapper
 * needs a new field later, add it here where it's easy to find.
 */

export type WebhookTopic =
  | 'products/create'
  | 'products/update'
  | 'products/delete'
  | 'inventory_levels/update'
  | 'locations/update';

/** The job handed to the queue after a webhook is verified and de-duplicated. */
export interface Job {
  /** Value of X-Shopify-Webhook-Id. Used for de-duplication and log correlation. */
  webhookId: string;
  topic: WebhookTopic;
  shopDomain: string;
  /** Parsed JSON body. Shape depends on `topic` — see the Shopify*Payload types below. */
  payload: unknown;
  /** When the webhook was received, for queue-age metrics and dead-letter logging. */
  receivedAt: string;
}

export interface ShopifyMoney {
  amount: string;
  currency_code: string;
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compare_at_price: string | null;
  inventory_quantity: number;
  inventory_policy: 'deny' | 'continue';
  inventory_item_id: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  image_id: number | null;
}

export interface ShopifyImage {
  id: number;
  src: string;
  variant_ids: number[];
}

export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  vendor: string;
  handle: string;
  status: 'active' | 'draft' | 'archived';
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

/** products/create and products/update share this shape. */
export type ShopifyProductPayload = ShopifyProduct;

/** products/delete sends only the id. */
export interface ShopifyProductDeletePayload {
  id: number;
}

export interface ShopifyInventoryLevelPayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
}

export interface ShopifyLocationPayload {
  id: number;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  country_code: string | null;
  zip: string | null;
  phone: string | null;
  active: boolean;
}

/** Minimal shape of the field this service sets on a Merchant API ProductInput. */
export interface GoogleProductInput {
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
  productAttributes: {
    title: string;
    description: string;
    link: string;
    imageLink: string;
    price: { amountMicros: string; currencyCode: string };
    salePrice?: { amountMicros: string; currencyCode: string };
    availability: 'in_stock' | 'out_of_stock' | 'backorder';
    gtin?: string[];
    mpn?: string;
    brand: string;
    itemGroupId: string;
  };
}
