import type { GoogleBusinessLocationPatch, ShopifyLocationPayload } from '../types';

/**
 * Maps a Shopify locations/update payload to a Business Profile location
 * PATCH body, using the merchant-provided GBP_LOCATION_MAP (Shopify
 * location ID -> Business Profile resource name).
 *
 * Returns null — not an error — when a location has no entry in the map.
 * Business Profile access is called out as optional in the README (Google
 * approves it separately from Merchant API), so a merchant using this
 * service for product/inventory sync only, with no Business Profile access
 * at all, would have an empty map and every location update should be a
 * silent no-op, not a failure.
 */
export function mapLocationToBusinessProfile(
  payload: ShopifyLocationPayload,
  gbpLocationMap: Record<string, string>,
): GoogleBusinessLocationPatch | null {
  const resourceName = gbpLocationMap[String(payload.id)];
  if (!resourceName) return null;

  const addressLines = [payload.address1, payload.address2].filter(
    (line): line is string => !!line && line.trim().length > 0,
  );

  return {
    name: resourceName,
    address: {
      addressLines,
      ...(payload.city ? { locality: payload.city } : {}),
      ...(payload.province ? { administrativeArea: payload.province } : {}),
      ...(payload.country_code ? { regionCode: payload.country_code } : {}),
      ...(payload.zip ? { postalCode: payload.zip } : {}),
    },
    ...(payload.phone ? { phoneNumbers: { primaryPhone: payload.phone } } : {}),
  };
}
