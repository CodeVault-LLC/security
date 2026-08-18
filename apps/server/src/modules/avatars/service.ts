import { createHash, timingSafeEqual } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import {
  conflict,
  DomainError,
  notFound,
  validationError,
} from "@codevault/core";
import { uuidv7 } from "@codevault/core/crypto";
import { schema, type Database } from "@codevault/db";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_DERIVATIVE_BYTES = 512 * 1024;
export const AVATAR_UPLOAD_TTL_MS = 15 * 60 * 1000;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function digestMatches(actualHex: string, expectedHex: string): boolean {
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function assertWebpDerivative(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 12 ||
    bytes.byteLength > MAX_AVATAR_DERIVATIVE_BYTES ||
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF" ||
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP"
  ) {
    throw new DomainError("SERVER_ERROR", "The avatar derivative is invalid.");
  }
}

export function validateDisplayFilename(filename: string): void {
  const length = Array.from(filename).length;
  const hasControlCharacter = Array.from(filename).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
  if (length < 1 || length > 255 || hasControlCharacter) {
    throw validationError("The avatar filename is not valid.");
  }
}

export async function rejectExpiredUpload(
  db: Database,
  id: string,
): Promise<void> {
  await db
    .update(schema.avatarImages)
    .set({
      status: "REJECTED",
      rejectionCode: "UPLOAD_EXPIRED",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.avatarImages.id, id),
        eq(schema.avatarImages.status, "AWAITING_UPLOAD"),
        sql`${schema.avatarImages.expiresAt} <= now()`,
      ),
    );
}

export async function queueQuarantinedAvatar(
  db: Database,
  input: {
    id: string;
    objectKey: string;
    observedSizeBytes: number;
    observedSha256: string;
  },
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.avatarImages)
      .set({
        status: "QUARANTINED",
        observedSizeBytes: input.observedSizeBytes,
        observedSha256: input.observedSha256,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schema.avatarImages.id, input.id),
          eq(schema.avatarImages.status, "AWAITING_UPLOAD"),
          sql`${schema.avatarImages.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!updated) throw conflict("This avatar upload is no longer writable.");

    await tx.insert(schema.mediaJobs).values({
      id: uuidv7(),
      purpose: "AVATAR_SANITIZE",
      targetId: updated.id,
      inputObjectKey: input.objectKey,
    });
    return updated;
  });
}

export async function loadOwnedPendingUpload(
  db: Database,
  id: string,
  organizationId: string,
  userId: string,
) {
  const [upload] = await db
    .select()
    .from(schema.avatarImages)
    .where(
      and(
        eq(schema.avatarImages.id, id),
        eq(schema.avatarImages.organizationId, organizationId),
        eq(schema.avatarImages.requestedBy, userId),
      ),
    )
    .limit(1);
  if (!upload) throw notFound("Avatar upload");
  return upload;
}
