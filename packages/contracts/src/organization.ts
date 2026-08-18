import { Type, type Static } from "@sinclair/typebox";

import { Timestamp, Uuid, UserRoleSchema } from "./common.js";

export const OrganizationSettings = Type.Object({
  id: Uuid,
  name: Type.String(),
  avatarId: Type.Union([Uuid, Type.Null()]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const UpdateOrganizationSettings = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 120 }),
});
export const OrganizationSecurityPolicy = Type.Object({
  mfaRequired: Type.Literal(true),
  inviteTtlHours: Type.Integer(),
  sessionIdleMinutes: Type.Integer(),
  sessionAbsoluteHours: Type.Integer(),
  recentMfaMinutes: Type.Integer(),
  updatedAt: Timestamp,
});
export const UpdateOrganizationSecurityPolicy = Type.Object({
  mfaRequired: Type.Optional(Type.Literal(true)),
  inviteTtlHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 72 })),
  sessionIdleMinutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
  sessionAbsoluteHours: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 24 }),
  ),
  recentMfaMinutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 30 })),
});
export const OrganizationUser = Type.Object({
  id: Uuid,
  email: Type.String({ format: "email" }),
  displayName: Type.String(),
  role: UserRoleSchema,
  disabled: Type.Boolean(),
  joinedAt: Timestamp,
  lastLoginAt: Type.Union([Timestamp, Type.Null()]),
  avatarId: Type.Union([Uuid, Type.Null()]),
});
export const OrganizationUserList = Type.Object({
  items: Type.Array(OrganizationUser),
});

export type OrganizationSettings = Static<typeof OrganizationSettings>;
export type OrganizationSecurityPolicy = Static<
  typeof OrganizationSecurityPolicy
>;
