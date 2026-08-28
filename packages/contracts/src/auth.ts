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
  rememberMe: Type.Optional(Type.Boolean({ default: false })),
});

export type LoginRequest = Static<typeof LoginRequest>;

const LoginChallengeResponse = Type.Object({
  challengeToken: Type.String({ minLength: 32 }),
  challenge: Type.Union([
    Type.Literal("MFA_REQUIRED"),
    Type.Literal("ENROLLMENT_REQUIRED"),
  ]),
  methods: Type.Array(
    Type.Union([Type.Literal("TOTP"), Type.Literal("WEBAUTHN")]),
    { minItems: 1, uniqueItems: true },
  ),
  expiresAt: Timestamp,
});

export const LoginCompleteRequest = Type.Object({
  challengeToken: Type.String({ minLength: 32, maxLength: 512 }),
  totp: Type.String({ pattern: "^[0-9]{6}$" }),
  rememberMe: Type.Optional(Type.Boolean({ default: false })),
});
export type LoginCompleteRequest = Static<typeof LoginCompleteRequest>;

export const StepUpRequest = Type.Object({
  totp: Type.String({ pattern: "^[0-9]{6}$" }),
});
export type StepUpRequest = Static<typeof StepUpRequest>;

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

export const LoginStartResponse = Type.Union([
  LoginChallengeResponse,
  LoginResponse,
]);
export type LoginStartResponse = Static<typeof LoginStartResponse>;

const WebAuthnTransport = Type.Union([
  Type.Literal("ble"),
  Type.Literal("cable"),
  Type.Literal("hybrid"),
  Type.Literal("internal"),
  Type.Literal("nfc"),
  Type.Literal("smart-card"),
  Type.Literal("usb"),
]);

const WebAuthnClientExtensions = Type.Record(Type.String(), Type.Unknown());

/** JSON form returned by navigator.credentials.create(). */
export const WebAuthnRegistrationCredential = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 2048 }),
  rawId: Type.String({ minLength: 1, maxLength: 2048 }),
  response: Type.Object({
    attestationObject: Type.String({ minLength: 1, maxLength: 131_072 }),
    clientDataJSON: Type.String({ minLength: 1, maxLength: 16_384 }),
    transports: Type.Optional(Type.Array(WebAuthnTransport, { maxItems: 8 })),
    publicKeyAlgorithm: Type.Optional(Type.Integer()),
    publicKey: Type.Optional(Type.String({ maxLength: 16_384 })),
    authenticatorData: Type.Optional(Type.String({ maxLength: 16_384 })),
  }),
  type: Type.Literal("public-key"),
  clientExtensionResults: WebAuthnClientExtensions,
  authenticatorAttachment: Type.Optional(
    Type.Union([Type.Literal("cross-platform"), Type.Literal("platform")]),
  ),
});
export type WebAuthnRegistrationCredential = Static<
  typeof WebAuthnRegistrationCredential
>;

/** JSON form returned by navigator.credentials.get(). */
export const WebAuthnAuthenticationCredential = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 2048 }),
  rawId: Type.String({ minLength: 1, maxLength: 2048 }),
  response: Type.Object({
    authenticatorData: Type.String({ minLength: 1, maxLength: 16_384 }),
    clientDataJSON: Type.String({ minLength: 1, maxLength: 16_384 }),
    signature: Type.String({ minLength: 1, maxLength: 16_384 }),
    userHandle: Type.Optional(
      Type.Union([Type.String({ maxLength: 2048 }), Type.Null()]),
    ),
  }),
  type: Type.Literal("public-key"),
  clientExtensionResults: WebAuthnClientExtensions,
  authenticatorAttachment: Type.Optional(
    Type.Union([Type.Literal("cross-platform"), Type.Literal("platform")]),
  ),
});
export type WebAuthnAuthenticationCredential = Static<
  typeof WebAuthnAuthenticationCredential
>;

export const WebAuthnCeremonyOptions = Type.Object({
  ceremonyToken: Type.String({ minLength: 32 }),
  /** PublicKeyCredentialCreationOptionsJSON or RequestOptionsJSON. */
  options: Type.Any(),
});
export type WebAuthnCeremonyOptions = Static<typeof WebAuthnCeremonyOptions>;

export const StartWebAuthnLoginRequest = Type.Object({
  challengeToken: Type.String({ minLength: 32, maxLength: 512 }),
});
export const CompleteWebAuthnLoginRequest = Type.Object({
  ceremonyToken: Type.String({ minLength: 32, maxLength: 512 }),
  response: WebAuthnAuthenticationCredential,
  rememberMe: Type.Optional(Type.Boolean({ default: false })),
});
export const StartWebAuthnStepUpRequest = Type.Object({});
export const CompleteWebAuthnStepUpRequest = Type.Object({
  ceremonyToken: Type.String({ minLength: 32, maxLength: 512 }),
  response: WebAuthnAuthenticationCredential,
});
export const StartWebAuthnRegistrationRequest = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
});
export const CompleteWebAuthnRegistrationRequest = Type.Object({
  ceremonyToken: Type.String({ minLength: 32, maxLength: 512 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  response: WebAuthnRegistrationCredential,
});
export const WebAuthnCredentialSummary = Type.Object({
  id: Uuid,
  name: Type.String(),
  transports: Type.Array(WebAuthnTransport),
  deviceType: Type.Union([
    Type.Literal("singleDevice"),
    Type.Literal("multiDevice"),
  ]),
  backedUp: Type.Boolean(),
  createdAt: Timestamp,
  lastUsedAt: Type.Union([Timestamp, Type.Null()]),
});
export type WebAuthnCredentialSummary = Static<
  typeof WebAuthnCredentialSummary
>;
export const WebAuthnCredentialList = Type.Object({
  items: Type.Array(WebAuthnCredentialSummary),
});

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

export const InviteTokenRequest = Type.Object({
  token: Type.String({ minLength: 32, maxLength: 512 }),
});
export const InviteInspection = Type.Object({
  organizationId: Uuid,
  organizationName: Type.String(),
  organizationAvatarId: Type.Union([Uuid, Type.Null()]),
  organizationAvatarDataUrl: Type.Union([
    Type.String({ maxLength: 700_000 }),
    Type.Null(),
  ]),
  email: Type.String({ format: "email" }),
  role: UserRoleSchema,
  expiresAt: Timestamp,
});
export type InviteInspection = Static<typeof InviteInspection>;
export const StartInviteEnrollmentRequest = Type.Intersect([
  InviteTokenRequest,
  Type.Object({
    displayName: Type.String({ minLength: 2, maxLength: 120 }),
    password: Type.String({ minLength: 12, maxLength: 512 }),
  }),
]);
export const TotpEnrollmentResponse = Type.Object({
  enrollmentToken: Type.String({ minLength: 32 }),
  provisioningUri: Type.String(),
  manualSecret: Type.String(),
  expiresAt: Timestamp,
});
export type TotpEnrollmentResponse = Static<typeof TotpEnrollmentResponse>;
export const StartMigratedEnrollmentRequest = Type.Object({
  challengeToken: Type.String({ minLength: 32, maxLength: 512 }),
});
export const ConfirmMigratedEnrollmentRequest = Type.Object({
  enrollmentToken: Type.String({ minLength: 32, maxLength: 512 }),
  totp: Type.String({ pattern: "^[0-9]{6}$" }),
});
export const ConfirmInviteEnrollmentRequest = Type.Object({
  enrollmentToken: Type.String({ minLength: 32, maxLength: 512 }),
  totp: Type.String({ pattern: "^[0-9]{6}$" }),
});
export const RecoveryCodeBundle = Type.Object({
  recoveryCodes: Type.Array(Type.String(), { minItems: 10, maxItems: 10 }),
});
export type RecoveryCodeBundle = Static<typeof RecoveryCodeBundle>;

export const RecoveryStartRequest = Type.Object({
  email: Type.String({ format: "email", maxLength: 320 }),
  password: Type.String({ minLength: 12, maxLength: 512 }),
  recoveryCode: Type.String({ minLength: 16, maxLength: 128 }),
});
export const RecoveryConfirmRequest = Type.Object({
  enrollmentToken: Type.String({ minLength: 32, maxLength: 512 }),
  totp: Type.String({ pattern: "^[0-9]{6}$" }),
});
export const RecoveryCompleteResponse = Type.Intersect([
  LoginResponse,
  RecoveryCodeBundle,
]);

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
