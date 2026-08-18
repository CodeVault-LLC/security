import { Type, type Static } from "@sinclair/typebox";

import { Sha256, Timestamp, Uuid } from "./common.js";

export const AvatarTarget = Type.Union([
  Type.Literal("USER"),
  Type.Literal("ORGANIZATION"),
]);

export const AvatarStatus = Type.Union([
  Type.Literal("AWAITING_UPLOAD"),
  Type.Literal("QUARANTINED"),
  Type.Literal("PROCESSING"),
  Type.Literal("READY"),
  Type.Literal("REJECTED"),
  Type.Literal("SUPERSEDED"),
]);

export const AvatarUploadRequest = Type.Object(
  {
    target: AvatarTarget,
    targetUserId: Type.Optional(Uuid),
    originalFilename: Type.String({ minLength: 1, maxLength: 255 }),
    declaredSizeBytes: Type.Integer({ minimum: 1, maximum: 5 * 1024 * 1024 }),
    declaredSha256: Sha256,
  },
  { additionalProperties: false },
);

export const AvatarUpload = Type.Object({
  id: Uuid,
  target: AvatarTarget,
  targetUserId: Type.Union([Uuid, Type.Null()]),
  targetOrganizationId: Type.Union([Uuid, Type.Null()]),
  status: AvatarStatus,
  rejectionCode: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Timestamp,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const DeleteCurrentAvatarQuery = Type.Object(
  { target: AvatarTarget },
  { additionalProperties: false },
);

export type AvatarUploadRequest = Static<typeof AvatarUploadRequest>;
export type AvatarUpload = Static<typeof AvatarUpload>;
