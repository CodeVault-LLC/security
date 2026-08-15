import { Type, type Static } from "@sinclair/typebox";

import { ActorSummary, Timestamp, Uuid, UserRoleSchema } from "./common.js";

/**
 * Authentication contracts.
 *
 * There is no registration schema in this file, and there never will be: users
 * exist only because an administrator invited them.
 */

export const LoginRequest = Type.Object({
  email: Type.String({ format: "email", maxLength: 320 }),
  password: Type.String({ minLength: 12, maxLength: 512 }),
});

export type LoginRequest = Static<typeof LoginRequest>;

export const SessionUser = Type.Object({
  id: Uuid,
  email: Type.String({ format: "email" }),
  displayName: Type.String(),
  role: UserRoleSchema,
  createdAt: Timestamp,
  lastLoginAt: Type.Union([Timestamp, Type.Null()]),
});

export type SessionUser = Static<typeof SessionUser>;

/**
 * Login response.
 *
 * The raw token crosses the wire exactly once and is stored by the Electron
 * main process. It is never handed to the renderer.
 */
export const LoginResponse = Type.Object({
  token: Type.String({ minLength: 32 }),
  expiresAt: Timestamp,
  user: SessionUser,
});

export type LoginResponse = Static<typeof LoginResponse>;

export const MeResponse = Type.Object({
  user: SessionUser,
  session: Type.Object({
    id: Uuid,
    expiresAt: Timestamp,
    createdAt: Timestamp,
  }),
});

export type MeResponse = Static<typeof MeResponse>;

export const CreateInviteRequest = Type.Object({
  email: Type.String({ format: "email", maxLength: 320 }),
  role: UserRoleSchema,
  /** Days until expiry; defaults to seven. */
  expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
});

export type CreateInviteRequest = Static<typeof CreateInviteRequest>;

export const Invite = Type.Object({
  id: Uuid,
  email: Type.String({ format: "email" }),
  role: UserRoleSchema,
  createdBy: ActorSummary,
  createdAt: Timestamp,
  expiresAt: Timestamp,
  acceptedAt: Type.Union([Timestamp, Type.Null()]),
  revokedAt: Type.Union([Timestamp, Type.Null()]),
});

export type Invite = Static<typeof Invite>;

/**
 * Invite creation response.
 *
 * The raw invite token is returned once, at creation, so the administrator can
 * copy it. Only its hash is stored.
 */
export const CreateInviteResponse = Type.Object({
  invite: Invite,
  token: Type.String({ minLength: 32 }),
});

export type CreateInviteResponse = Static<typeof CreateInviteResponse>;

export const AcceptInviteRequest = Type.Object({
  token: Type.String({ minLength: 32, maxLength: 512 }),
  displayName: Type.String({ minLength: 2, maxLength: 120 }),
  password: Type.String({ minLength: 12, maxLength: 512 }),
});

export type AcceptInviteRequest = Static<typeof AcceptInviteRequest>;

export const UserSummary = Type.Object({
  id: Uuid,
  email: Type.String({ format: "email" }),
  displayName: Type.String(),
  role: UserRoleSchema,
  disabled: Type.Boolean(),
  createdAt: Timestamp,
  lastLoginAt: Type.Union([Timestamp, Type.Null()]),
});

export type UserSummary = Static<typeof UserSummary>;

export const UpdateUserRequest = Type.Object({
  role: Type.Optional(UserRoleSchema),
  disabled: Type.Optional(Type.Boolean()),
  displayName: Type.Optional(Type.String({ minLength: 2, maxLength: 120 })),
});

export type UpdateUserRequest = Static<typeof UpdateUserRequest>;
