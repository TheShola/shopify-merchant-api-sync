import { beforeEach, describe, expect, it } from 'vitest';
import { mapInventoryLevelToLocalInventory } from '../../src/mappers/localInventory';
import { _resetForTests, recordOfferId } from '../../src/mappers/inventoryIndex';
import type { ShopifyInventoryLevelPayload } from '../../src/types';

const payload: ShopifyInventoryLevelPayload = {
  inventory_item_id: 55601837221,
  location_id: 65581383,
  available: 7,
};

beforeEach(() => {
  _resetForTests();
});

describe('mapInventoryLevelToLocalInventory', () => {
  it('returns null when the inventory_item_id has not been seen via a product webhook', () => {
    expect(mapInventoryLevelToLocalInventory(payload)).toBeNull();
  });

  it('maps to in_stock with the recorded offerId once the index has an entry', () => {
    recordOfferId(55601837221, 'LINEN-SHIRT-BLUE-M');

    const result = mapInventoryLevelToLocalInventory(payload);

    expect(result).toEqual({
      offerId: 'LINEN-SHIRT-BLUE-M',
      storeCode: '65581383',
      availability: 'in_stock',
      quantity: '7',
    });
  });

  it('maps a zero-quantity update to out_of_stock', () => {
    recordOfferId(55601837221, 'LINEN-SHIRT-BLUE-M');

    const result = mapInventoryLevelToLocalInventory({ ...payload, available: 0 });

    expect(result?.availability).toBe('out_of_stock');
    expect(result?.quantity).toBe('0');
  });

  it('floors a negative `available` value at zero rather than passing it through', () => {
    recordOfferId(55601837221, 'LINEN-SHIRT-BLUE-M');

    const result = mapInventoryLevelToLocalInventory({ ...payload, available: -3 });

    expect(result?.availability).toBe('out_of_stock');
    expect(result?.quantity).toBe('0');
  });
});
