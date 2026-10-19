/**
 * In-memory index: Shopify inventory_item_id -> Merchant API offerId.
 *
 * This exists because of a gap in Shopify's webhook payloads worth being
 * able to explain unprompted: inventory_levels/update carries only
 * `inventory_item_id`, `location_id` and `available` — no product or
 * variant reference at all. The only place that link exists is the
 * products/create or products/update payload, where each variant carries
 * both its own `inventory_item_id` and the sku/id that offerId is derived
 * from (see resolveOfferId in product.ts). So the processor records that
 * link every time a product webhook is handled, and inventory_levels/update
 * jobs look it up here instead of having a product reference of their own.
 *
 * Same durability caveat as the job queue in queue.ts: this is an in-memory
 * Map, empty again after a restart. In production this would be a row in
 * whatever datastore the service already has (inventory_item_id -> offerId),
 * not a message queue — it's a lookup table, not a unit of work.
 */

const inventoryItemToOfferId = new Map<number, string>();

export function recordOfferId(inventoryItemId: number, offerId: string): void {
  inventoryItemToOfferId.set(inventoryItemId, offerId);
}

export function lookupOfferId(inventoryItemId: number): string | undefined {
  return inventoryItemToOfferId.get(inventoryItemId);
}

/** Test-only: clears all entries so tests don't leak state between each other. */
export function _resetForTests(): void {
  inventoryItemToOfferId.clear();
}
