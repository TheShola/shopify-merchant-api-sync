import 'dotenv/config';

/**
 * Reads and validates environment variables once at startup, so a missing
 * secret fails loudly on boot instead of surfacing as a confusing 500 the
 * first time a webhook arrives.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  shopify: {
    webhookSecret: required('SHOPIFY_WEBHOOK_SECRET'),
    storeDomain: required('SHOPIFY_STORE_DOMAIN'),
  },
  google: {
    merchantAccountId: required('GOOGLE_MERCHANT_ACCOUNT_ID'),
    dataSource: required('GOOGLE_DATA_SOURCE'),
    applicationCredentials: required('GOOGLE_APPLICATION_CREDENTIALS'),
  },
  /** Shopify location ID -> Business Profile location resource name. Optional feature. */
  gbpLocationMap: parseLocationMap(process.env.GBP_LOCATION_MAP),
} as const;

function parseLocationMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('GBP_LOCATION_MAP must be a JSON object');
    }
    return parsed as Record<string, string>;
  } catch (err) {
    throw new Error(
      `GBP_LOCATION_MAP is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
