/** Closed vendor-directory vocabulary shared by contracts and services. */
export const VENDOR_ROUTE_TYPES = ["EMAIL", "MANUAL"] as const;

export type VendorRouteType = (typeof VENDOR_ROUTE_TYPES)[number];

export const ENCRYPTION_POLICIES = [
  "FORBIDDEN",
  "OPTIONAL",
  "REQUIRED",
] as const;

export type EncryptionPolicy = (typeof ENCRYPTION_POLICIES)[number];

export const CRYPTO_MODES = [
  "PLAIN",
  "ENCRYPTED",
  "SIGNED_AND_ENCRYPTED",
] as const;

export type CryptoMode = (typeof CRYPTO_MODES)[number];

const VENDOR_ROUTE_TYPE_SET = new Set<string>(VENDOR_ROUTE_TYPES);
const ENCRYPTION_POLICY_SET = new Set<string>(ENCRYPTION_POLICIES);

export function isVendorRouteType(value: unknown): value is VendorRouteType {
  return typeof value === "string" && VENDOR_ROUTE_TYPE_SET.has(value);
}

export function isEncryptionPolicy(value: unknown): value is EncryptionPolicy {
  return typeof value === "string" && ENCRYPTION_POLICY_SET.has(value);
}
