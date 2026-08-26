import { Type, type Static } from "@sinclair/typebox";

import { Timestamp, Uuid, UserRoleSchema } from "./common.js";

export const OrganizationSettings = Type.Object({
  id: Uuid,
  name: Type.String(),
  contactName: Type.Union([Type.String(), Type.Null()]),
  contactEmail: Type.Union([Type.String({ format: "email" }), Type.Null()]),
  reportFooter: Type.Union([Type.String(), Type.Null()]),
  avatarId: Type.Union([Uuid, Type.Null()]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const UpdateOrganizationSettings = Type.Object({
  name: Type.Optional(Type.String({ minLength: 2, maxLength: 120 })),
  contactName: Type.Optional(
    Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
  ),
  contactEmail: Type.Optional(
    Type.Union([Type.String({ format: "email", maxLength: 320 }), Type.Null()]),
  ),
  reportFooter: Type.Optional(
    Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  ),
});
export const OrganizationSecurityPolicy = Type.Object({
  mfaRequired: Type.Boolean(),
  inviteTtlHours: Type.Integer(),
  sessionIdleMinutes: Type.Integer(),
  sessionAbsoluteHours: Type.Integer(),
  recentMfaMinutes: Type.Integer(),
  mcpEnabled: Type.Boolean(),
  updatedAt: Timestamp,
});
export const UpdateOrganizationSecurityPolicy = Type.Object({
  mfaRequired: Type.Optional(Type.Boolean()),
  inviteTtlHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 72 })),
  sessionIdleMinutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
  sessionAbsoluteHours: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 24 }),
  ),
  recentMfaMinutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 30 })),
  mcpEnabled: Type.Optional(Type.Boolean()),
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
export type OrganizationUser = Static<typeof OrganizationUser>;
export type OrganizationUserList = Static<typeof OrganizationUserList>;

export type OrganizationSettings = Static<typeof OrganizationSettings>;
export type OrganizationSecurityPolicy = Static<
  typeof OrganizationSecurityPolicy
>;
