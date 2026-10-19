import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapLocationToBusinessProfile } from '../../src/mappers/location';
import type { ShopifyLocationPayload } from '../../src/types';

const location: ShopifyLocationPayload = JSON.parse(
  readFileSync(path.join(__dirname, '../../samples/locations-update.json'), 'utf8'),
) as ShopifyLocationPayload;

describe('mapLocationToBusinessProfile', () => {
  it('returns null when the location has no entry in GBP_LOCATION_MAP', () => {
    expect(mapLocationToBusinessProfile(location, {})).toBeNull();
  });

  it('maps a configured location to a Business Profile patch body', () => {
    const map = { '65581383': 'locations/12345678901234567890' };

    const result = mapLocationToBusinessProfile(location, map);

    expect(result).toEqual({
      name: 'locations/12345678901234567890',
      address: {
        addressLines: ['14 Grafton Street'],
        locality: 'Dublin',
        administrativeArea: 'Dublin',
        regionCode: 'IE',
        postalCode: 'D02 XY45',
      },
      phoneNumbers: { primaryPhone: '+353 1 234 5678' },
    });
  });

  it('omits phoneNumbers entirely when Shopify has no phone on file', () => {
    const map = { '65581383': 'locations/12345678901234567890' };
    const result = mapLocationToBusinessProfile({ ...location, phone: null }, map);

    expect(result?.phoneNumbers).toBeUndefined();
  });

  it('filters out a null address2 rather than including an empty line', () => {
    const map = { '65581383': 'locations/12345678901234567890' };
    const result = mapLocationToBusinessProfile(
      { ...location, address1: '14 Grafton Street', address2: null },
      map,
    );

    expect(result?.address.addressLines).toEqual(['14 Grafton Street']);
  });
});
