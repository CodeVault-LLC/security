import { and, eq, sql } from "drizzle-orm";
import { Type } from "@sinclair/typebox";

import {
  AvatarUpload,
  AvatarUploadRequest,
  DeleteCurrentAvatarQuery,
  ErrorResponse,
} from "@codevault/contracts";
import {
  conflict,
  DomainError,
  notFound,
  permissionDenied,
  validationError,
} from "@codevault/core";
import { uuidv7 } from "@codevault/core/crypto";
import { schema } from "@codevault/db";

import type { AppInstance } from "../../http/app-instance.js";
import {
  principalOf,
  requireOrganizationAdminWithRecentMfa,
} from "../../http/guards.js";
import {
  assertWebpDerivative,
  AVATAR_UPLOAD_TTL_MS,
  digestMatches,
  loadOwnedPendingUpload,
  MAX_AVATAR_BYTES,
  queueQuarantinedAvatar,
  rejectExpiredUpload,
  sha256Hex,
  validateDisplayFilename,
} from "./service.js";

const Id = Type.Object({ id: Type.String({ format: "uuid" }) });

function toUpload(row: typeof schema.avatarImages.$inferSelect) {
  return {
    id: row.id,
    target: row.target,
    targetUserId: row.targetUserId,
    targetOrganizationId: row.targetOrganizationId,
    status: row.status,
    rejectionCode: row.rejectionCode,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function registerAvatarRoutes(app: AppInstance): Promise<void> {
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_AVATAR_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post(
    "/v1/avatar-uploads",
    {
      schema: {
        body: AvatarUploadRequest,
        response: { 201: AvatarUpload, 403: ErrorResponse },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const principal = principalOf(request);
      const body = request.body;
      validateDisplayFilename(body.originalFilename);

      let targetUserId: string | null = null;
      let targetOrganizationId: string | null = null;
      if (body.target === "USER") {
        targetUserId = body.targetUserId ?? principal.user.id;
        if (targetUserId !== principal.user.id) {
          throw permissionDenied("You may change only your own avatar.");
        }
      } else {
        requireOrganizationAdminWithRecentMfa(request);
        if (body.targetUserId !== undefined) {
          throw validationError("An organization avatar cannot target a user.");
        }
        targetOrganizationId = principal.organization.id;
      }

      const id = uuidv7();
      const [created] = await app.db
        .insert(schema.avatarImages)
        .values({
          id,
          organizationId: principal.organization.id,
          target: body.target,
          targetUserId,
          targetOrganizationId,
          originalFilename: body.originalFilename,
          declaredSizeBytes: body.declaredSizeBytes,
          declaredSha256: body.declaredSha256,
          quarantineObjectKey: `quarantine/avatars/${id}`,
          requestedBy: principal.user.id,
          expiresAt: new Date(Date.now() + AVATAR_UPLOAD_TTL_MS).toISOString(),
        })
        .returning();
      return reply.status(201).send(toUpload(created!));
    },
  );

  app.put(
    "/v1/avatar-uploads/:id/content",
    {
      schema: {
        params: Id,
        response: { 200: AvatarUpload, 400: ErrorResponse, 409: ErrorResponse },
      },
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
    },
    async (request) => {
      const principal = principalOf(request);
      const declaredLength = request.headers["content-length"];
      if (
        request.headers["transfer-encoding"] !== undefined ||
        typeof declaredLength !== "string" ||
        !/^[1-9][0-9]*$/u.test(declaredLength)
      ) {
        throw validationError("A valid Content-Length header is required.");
      }
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length > MAX_AVATAR_BYTES) {
        throw validationError("The avatar exceeds the upload limit.");
      }
      if (
        !Buffer.isBuffer(request.body) ||
        request.body.byteLength !== length
      ) {
        throw validationError(
          "The avatar body length does not match Content-Length.",
        );
      }

      await rejectExpiredUpload(app.db, request.params.id);
      const upload = await loadOwnedPendingUpload(
        app.db,
        request.params.id,
        principal.organization.id,
        principal.user.id,
      );
      if (upload.status !== "AWAITING_UPLOAD") {
        throw conflict("This avatar upload is no longer writable.");
      }

      const observedSha256 = sha256Hex(request.body);
      if (
        length !== upload.declaredSizeBytes ||
        !digestMatches(observedSha256, upload.declaredSha256)
      ) {
        await app.db
          .update(schema.avatarImages)
          .set({
            status: "REJECTED",
            rejectionCode: "INTEGRITY_MISMATCH",
            observedSizeBytes: length,
            observedSha256,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(schema.avatarImages.id, upload.id),
              eq(schema.avatarImages.status, "AWAITING_UPLOAD"),
            ),
          );
        await app.storage
          .deleteObject(upload.quarantineObjectKey)
          .catch(() => undefined);
        throw new DomainError(
          "UPLOAD_FAILED",
          "The avatar failed its integrity check.",
        );
      }

      await app.storage.putObject(
        upload.quarantineObjectKey,
        request.body,
        "application/octet-stream",
      );
      const updated = await queueQuarantinedAvatar(app.db, {
        id: upload.id,
        objectKey: upload.quarantineObjectKey,
        observedSizeBytes: length,
        observedSha256,
      });
      return toUpload(updated);
    },
  );

  app.get(
    "/v1/avatars/:id/content",
    { schema: { params: Id } },
    async (request, reply) => {
      const principal = principalOf(request);
      const [avatar] = await app.db
        .select()
        .from(schema.avatarImages)
        .where(
          and(
            eq(schema.avatarImages.id, request.params.id),
            eq(schema.avatarImages.organizationId, principal.organization.id),
            eq(schema.avatarImages.status, "READY"),
          ),
        )
        .limit(1);
      if (!avatar?.sanitizedObjectKey) throw notFound("Avatar");
      const bytes = await app.storage.getObject(avatar.sanitizedObjectKey);
      assertWebpDerivative(bytes);
      if (
        avatar.sanitizedSha256 === null ||
        !digestMatches(sha256Hex(bytes), avatar.sanitizedSha256)
      ) {
        throw new DomainError(
          "SERVER_ERROR",
          "The avatar derivative failed its integrity check.",
        );
      }
      return reply
        .header("Content-Type", "image/webp")
        .header("Content-Disposition", "inline")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, max-age=300")
        .header("ETag", `"${avatar.sanitizedSha256 ?? avatar.id}"`)
        .send(Buffer.from(bytes));
    },
  );

  app.delete(
    "/v1/avatars/current",
    {
      schema: {
        querystring: DeleteCurrentAvatarQuery,
        response: { 204: Type.Null() },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request);
      const predicate =
        request.query.target === "USER"
          ? eq(schema.avatarImages.targetUserId, principal.user.id)
          : eq(
              schema.avatarImages.targetOrganizationId,
              principal.organization.id,
            );
      if (request.query.target === "ORGANIZATION") {
        requireOrganizationAdminWithRecentMfa(request);
      }
      const [removed] = await app.db
        .update(schema.avatarImages)
        .set({ status: "SUPERSEDED", updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.avatarImages.organizationId, principal.organization.id),
            eq(schema.avatarImages.status, "READY"),
            predicate,
          ),
        )
        .returning({ objectKey: schema.avatarImages.sanitizedObjectKey });
      if (removed?.objectKey)
        await app.storage
          .deleteObject(removed.objectKey)
          .catch(() => undefined);
      return reply.status(204).send(null);
    },
  );
}
