import type { GoogleLocalInventoryInput, ShopifyInventoryLevelPayload } from '../types';
import { lookupOfferId } from './inventoryIndex';

/**
 * Maps an inventory_levels/update payload to a Merchant API local inventory
 * update. `offerId` can't be derived from this payload alone — see
 * inventoryIndex.ts for why — so the caller (processor.ts) resolves it via
 * lookupOfferId() and this function stays a pure, easily-tested mapping
 * from there.
 *
 * `storeCode` is set to the Shopify location ID as a string. That's an
 * assumption, not a given: Merchant Center's local inventory feed expects
 * `storeCode` to match whatever store code the merchant registered when
 * setting up local inventory ads, which is a separate manual configuration
 * step in Merchant Center. Using the Shopify location ID directly only
 * works if that was also used as the Merchant Center store code — worth
 * surfacing as a setup prerequisite, not hard-coding silently.
 *
 * No `backorder` state here, unlike online availability in product.ts:
 * local/in-store inventory is binary — a shopper either can or can't pick
 * an item up at a specific store today. Google's local inventory schema
 * doesn't have a backorder concept for that reason.
 */
export function mapInventoryLevelToLocalInventory(
  payload: ShopifyInventoryLevelPayload,
): GoogleLocalInventoryInput | null {
  const offerId = lookupOfferId(payload.inventory_item_id);
  if (!offerId) {
    // Haven't seen a products/create or products/update for this item yet
    // (or it arrived before this process started and the in-memory index
    // doesn't have it). Returning null lets the caller log and dead-letter
    // this specific job without crashing the worker over one stale lookup.
    return null;
  }

  const available = Math.max(payload.available, 0);

  return {
    offerId,
    storeCode: String(payload.location_id),
    availability: available > 0 ? 'in_stock' : 'out_of_stock',
    quantity: String(available),
  };
}
