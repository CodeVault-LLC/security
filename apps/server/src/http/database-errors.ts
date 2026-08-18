import { conflict, validationError, type DomainError } from "@codevault/core";

/**
 * PostgreSQL error translation.
 *
 * A constraint violation is nearly always a client mistake — an identifier
 * that does not exist, a duplicate that already does — and answering it with a
 * 500 both misleads the researcher and hides a real fault behind noise. The
 * message is written from the constraint, never from the driver's text, so the
 * response never leaks a table name, a column list or a parameter value.
 */

interface PostgresError {
  code?: string;
  constraint?: string;
  table?: string;
  detail?: string;
}

/** The SQLSTATE codes worth translating. */
const CODES = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  notNullViolation: "23502",
  serializationFailure: "40001",
  deadlock: "40P01",
} as const;

/**
 * Constraint names mapped to a sentence a researcher can act on.
 *
 * Anything not listed falls back to a generic message for its class, so a new
 * constraint fails safe rather than describing the schema.
 */
const CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  affected_ranges_asset_id_fkey: "That asset does not exist.",
  finding_assets_asset_id_fkey: "That asset does not exist.",
  finding_assets_primary_key: "This finding already has a primary asset.",
  asset_relationships_not_self: "An asset cannot relate to itself.",
  asset_relationships_unique: "That relationship already exists.",
  asset_identifiers_unique:
    "That identifier is already recorded on this asset.",
  asset_identifiers_primary_key: "This asset already has a primary identifier.",
  asset_versions_unique: "That version is already recorded.",
  assets_vendor_id_fk: "That vendor does not exist.",
  vendors_normalized_name_key: "A vendor with that name already exists.",
  vendors_slug_key: "A vendor with that stable identifier already exists.",
  vendors_name_not_blank: "Vendor names cannot be blank.",
  vendors_normalized_name_not_blank: "Vendor names cannot be blank.",
  vendors_source_https: "Vendor source links must use HTTPS.",
  vendors_website_https: "Vendor website links must use HTTPS.",
  vendor_routes_name_key: "That vendor already has a route with this name.",
  vendor_routes_requirements_type_check:
    "The route requirements do not match the selected route type.",
  vendor_public_keys_fingerprint_key:
    "That OpenPGP key is already recorded for this vendor.",
  vendor_public_keys_fingerprint_check: "The OpenPGP fingerprint is not valid.",
  vendor_public_keys_verification_shape:
    "Public-key verification needs both a verifier and a timestamp.",
  users_email_key: "An account already exists for that address.",
  reports_case_audience_key:
    "This case already has a report for that audience.",
  finding_identifiers_unique: "That identifier is already recorded.",
  finding_scores_approved_key:
    "This finding already has an approved score for that scheme.",
  embargoes_case_key: "This case already has an embargo record.",
  embargoes_window_check: "An embargo cannot end before it starts.",
  disclosure_events_custom_label: "A custom event needs a label.",
  artifacts_sha256_check: "The digest must be a SHA-256 hex string.",
};

function asPostgresError(error: unknown): PostgresError | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as PostgresError & { cause?: unknown };

  if (typeof candidate.code === "string") {
    return candidate;
  }

  // Drizzle wraps driver errors, so the SQLSTATE is one level down.
  if (candidate.cause !== undefined) {
    return asPostgresError(candidate.cause);
  }

  return null;
}

/**
 * Converts a database error into a domain error, or returns null.
 *
 * Returning null means "not a constraint violation" — the caller rethrows and
 * the generic handler reports a server error, which is the right answer for a
 * connection failure or a genuine bug.
 */
export function translateDatabaseError(error: unknown): DomainError | null {
  const postgres = asPostgresError(error);

  if (postgres === null || postgres.code === undefined) {
    return null;
  }

  const named =
    postgres.constraint === undefined
      ? undefined
      : CONSTRAINT_MESSAGES[postgres.constraint];

  if (postgres.code === CODES.uniqueViolation) {
    return conflict(named ?? "That record already exists.");
  }

  if (postgres.code === CODES.foreignKeyViolation) {
    return validationError(
      named ?? "One of the records this refers to does not exist.",
    );
  }

  if (
    postgres.code === CODES.checkViolation ||
    postgres.code === CODES.notNullViolation
  ) {
    return validationError(named ?? "The request was not valid.");
  }

  if (
    postgres.code === CODES.serializationFailure ||
    postgres.code === CODES.deadlock
  ) {
    return conflict(
      "The data changed while your request was being applied. Try again.",
    );
  }

  return null;
}
