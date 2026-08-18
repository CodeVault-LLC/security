# Organization Security, MFA, and Safe Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one first-class organization the top-level CodeVault security boundary, require TOTP MFA before any user receives application access, separate organization and personal settings, and make all displayable image uploads pass through a quarantined, contained decode-and-reencode pipeline.

**Architecture:** A singleton `organizations` row owns memberships, invitations, security policy, root research records, and organization-wide provider policy. Authentication becomes password → short-lived MFA challenge → TOTP verification → session; recovery enters a re-enrollment-only state and never grants ordinary access. Avatar bytes are accepted only from authenticated users, stored under opaque quarantine keys, decoded in a least-privilege media worker with a strict JPEG/PNG loader allow-list and resource limits, and published only as fixed WebP derivatives.

**Tech Stack:** TypeScript 5.9, Bun 1.3, Node 24, Fastify, PostgreSQL 18, Drizzle ORM, Electron, React 19, TanStack Router/Query, pg-boss, S3-compatible private object storage, `otpauth@9.5.1`, `qrcode.react@4.2.0`, `sharp@0.35.3` or newer patched 0.35.x with bundled libvips 8.18.3 or newer.

**Spec:** This plan is the requirements artifact. The user explicitly requested a plan instead of a separate specification; the approved requirements are captured in “Required behavior” below.

## Global Constraints

- Support exactly one organization per deployment. Do not build organization switching or a generic `/organization` screen.
- The first bootstrap command is `bun run admin:create --organization "<name>" --email <address> --name "<display name>"` and commits nothing until password and TOTP enrollment are confirmed.
- Every active account has exactly one organization membership. Role authority lives on the membership, not `users`.
- `ADMIN` is the only role that may invite, disable, change roles, reset another user’s MFA, or mutate organization-wide rules.
- The database, not only route code, prevents a commit that would leave the organization without an active administrator.
- Every active member can read every case, finding, and organization-visible activity record. Existing case access continues to govern writing; `VIEWER` remains globally read-only.
- MFA cannot be disabled by organization policy. TOTP uses a unique 20-byte secret, HMAC-SHA1 for authenticator compatibility, six digits, a 30-second period, and a validation window of at most one adjacent step in either direction.
- A TOTP counter is accepted at most once per credential, including across concurrent requests. Five failed attempts consume an MFA challenge; ten failed attempts per account/source or twenty per account across sources in 15 minutes trigger escalating delay and temporary throttling.
- TOTP secrets are AES-256-GCM encrypted with versioned installation keys. Secrets, provisioning URIs, raw challenge tokens, invitation tokens, and recovery codes never enter logs or audit payloads.
- Generate ten 128-bit recovery codes. Store only versioned HMAC-SHA256 digests. A recovery code is single-use and can only start TOTP re-enrollment; it cannot create a full session.
- Organization-policy, role, disablement, invitation, MFA reset, and organization-avatar mutations require MFA verified within the last 10 minutes by default.
- Avatar input is limited to one JPEG or PNG, at most 5 MiB compressed, at most 16 megapixels, at most 8192 pixels on either edge, one frame/page, and three or four channels.
- Do not accept SVG, GIF, TIFF, AVIF, HEIF, PDF, BMP, remote URLs, file paths, or declared MIME as proof of format for avatars.
- Never pass an attacker-controlled filename, path, URL, metadata value, or option to a shell, ImageMagick, Ghostscript, ExifTool, or decoder CLI.
- Only a 512×512-or-smaller, metadata-free, fixed-quality WebP derivative may be rendered. Raw uploads remain private and are deleted after success, rejection, or expiry.
- Decoder work runs outside the API and desktop processes with no application session secrets, no general database role, prefix-limited object-storage credentials, restricted egress, a read-only filesystem, no Linux capabilities, `no-new-privileges`, and CPU/memory/PID/time limits.
- The Electron renderer never receives filesystem paths, the bearer session token, raw object-storage credentials, or unsanitized image bytes.
- Use strict TDD for every behavior: add one failing test, run it and observe the intended failure, add minimal production code, rerun the focused test, then run the affected suite before committing.
- Do not weaken existing Electron sandbox, context isolation, private-bucket, audit, or AI context-filtering controls.

## Security Research Basis

- [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) recommends a 30-second step, at most one step of transmission delay, strong random secrets, protected key storage, and secure transport.
- [RFC 4226](https://www.rfc-editor.org/rfc/rfc4226) requires server throttling and narrowly bounded validation windows for OTPs.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) requires rate limiting for low-entropy authenticator outputs, one-use/replay resistance, protected authenticator lifecycle management, hashed recovery codes, and notifications around recovery. It also states that manually entered OTPs are not phishing-resistant. The UI must say this plainly, and the credential model must allow a later WebAuthn method without rewriting session issuance.
- [OWASP File Upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) calls for defense in depth: allow-list formats, ignore claimed Content-Type, generate opaque names, cap sizes, authorize uploads, isolate storage, and rewrite displayable images.
- [sharp’s July/August 2026 advisory](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj) says untrusted input is affected below `sharp` 0.35.0 and identifies 0.35.3/libvips 8.18.3 as patched. Dependency and runtime checks in this plan are release blockers.
- [sharp constructor guidance](https://sharp.pixelplumbing.com/api-constructor/) says to retain `failOn: "warning"`, keep safety features enabled, and set pixel/channel/page limits for untrusted input.
- [sharp operation blocking](https://sharp.pixelplumbing.com/api-utility/#block) supports blocking all loaders and unblocking only named JPEG/PNG buffer loaders. This is mandatory even when magic-byte validation already passed.
- [AWS presigned URL guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) treats signed URLs as reusable bearer capabilities until expiry and notes that PUT can replace the named object. Avatars are small enough to stream once through the authenticated API, avoiding that capability and its replacement race.

## Required Behavior

### Organization and authorization

- Fresh database: no organization exists until `admin:create` atomically creates the organization, policy, user, administrator membership, TOTP credential, recovery codes, and audit event.
- Existing database: migration creates `CodeVault Organization` only when users already exist, transfers every `users.role` value into membership, scopes existing records, and revokes existing sessions so each user enrolls TOTP after their next successful password check.
- Organization screens are `/organization/users`, `/organization/users/$userId`, `/organization/settings`, and `/organization/security`. All members can read them; only administrators receive mutation controls and server authorization.
- Personal screens are `/settings/profile`, `/settings/appearance`, and `/settings/security`. Legacy `/settings` and `/settings/account` redirect to `/settings/profile`.
- A user may change only their own name, avatar, theme, password, TOTP, recovery codes, and sessions.

### Authentication and recovery

- Invitation onboarding is: inspect invite → profile/password → locally rendered TOTP QR/manual secret → valid TOTP confirmation → one-time recovery-code display → sign in.
- Password success never creates a session. It returns an opaque, hashed-at-rest, five-minute challenge held by Electron main, not by the renderer.
- Challenge completion rechecks user enabled state and active membership inside the same transaction that consumes the challenge, accepts the TOTP counter, and creates the session.
- Existing migrated users receive an enrollment challenge after password verification and cannot reach application routes until enrollment succeeds.
- Lost-authenticator recovery, whether started by a saved recovery code or a recently MFA-verified administrator, revokes all sessions, issues a short-lived re-enrollment capability, and grants no research-data access until a new TOTP credential is confirmed.
- Sensitive changes use step-up MFA when the session’s last TOTP confirmation is older than organization policy permits.

### Upload and decoder containment

- The native picker filters JPEG/PNG for usability, but the server and media worker independently verify byte signatures and decoded metadata.
- API ingestion computes SHA-256 while accepting at most 5 MiB and writes an opaque quarantine key; no original filename forms any path or response header.
- The media worker checks the stored object’s size and SHA-256 before decoding, blocks every libvips loader, unblocks only `VipsForeignLoadJpegBuffer` and `VipsForeignLoadPngBuffer`, and rejects any decoded format not exactly JPEG/PNG.
- Worker success writes a fresh opaque `.webp` key, verifies output magic/dimensions, atomically marks it current, supersedes the old avatar, deletes raw input, and emits an audit event through a narrow database-owned security-definer finalization function.
- Worker failure records a stable rejection category rather than a native decoder message, deletes raw input, and cannot disturb the currently active avatar.
- Existing evidence previews use the same loader allow-list and limits. Unsupported image formats receive `previewKind: "NONE"`; evidence originals remain downloadable as attachments and are never rendered inline.
- General evidence uploads remain unavailable until a worker streams the stored object through SHA-256 and matches the client declaration. Preview generation never runs against an unverified object, and integrity verification never buffers a multi-gigabyte artifact.

## File and Responsibility Map

### Database and domain

- Create `packages/db/src/schema/organizations.ts`: organizations and bounded security policy.
- Modify `packages/db/src/schema/auth.ts`: users without global role, memberships, invitations, sessions with MFA metadata, TOTP credentials, recovery codes, MFA challenges, invitation enrollments, and MFA recovery enrollments.
- Create `packages/db/src/schema/media.ts`: avatar upload state and current-target constraints.
- Modify `packages/db/src/schema/cases.ts`, `assets.ts`, `ai.ts`, and `audit.ts`: root organization ownership.
- Create `packages/db/drizzle/0004_organization_security_mfa.sql`: transactional backfill, singleton/final-admin constraints, session revocation, indexes, and grants template.
- Create `packages/core/src/organization.ts`: membership and policy types plus pure authorization rules.
- Modify `packages/core/src/permissions.ts`: organization-aware acting user and read-all case semantics.

### Server authentication and organization APIs

- Create `apps/server/src/auth/secret-keyring.ts`: versioned AES-GCM/HKDF/HMAC key handling.
- Create `apps/server/src/auth/totp.ts`: OTPAuth wrapper, provisioning URI, counter selection, and atomic replay guard interface.
- Create `apps/server/src/auth/mfa-challenges.ts`: password, login, step-up, enrollment, and recovery challenge lifecycle.
- Split `apps/server/src/modules/auth/routes.ts` into `login-routes.ts`, `enrollment-routes.ts`, `recovery-routes.ts`, and a small registrar.
- Create `apps/server/src/modules/organization/routes.ts`, `service.ts`, and `queries.ts`.
- Create `apps/server/src/modules/settings/routes.ts` for self-service only.
- Create `apps/server/src/modules/avatars/routes.ts` and `service.ts` for bounded ingestion and authenticated derivative reads.
- Modify `apps/server/src/http/guards.ts`, `auth/session.ts`, `app.ts`, `routes.ts`, `config.ts`, `services/case-access.ts`, `services/storage.ts`, and AI policy routes.

### Media processing

- Create `apps/media-worker/` as a focused workspace with `src/index.ts`, `src/claim-job.ts`, `src/sanitize-image.ts`, tests, package manifest, and TypeScript config.
- Create `infra/media-worker.Dockerfile` and `docs/operations/media-worker-security.md`.
- Modify `apps/worker/src/jobs/artifact-preview.ts` to share the decoder policy until evidence previews are moved to the media worker; do not broaden supported loaders.

### Desktop and UI

- Modify preload contracts and main IPC/API client so MFA challenges and avatar paths remain in Electron main.
- Create signed-out `invite-onboarding.tsx` and `mfa-challenge.tsx` flows.
- Split the 840-line `routes/misc.tsx`; keep reports/activity there and move settings/organization screens into focused route modules.
- Create reusable `avatar.tsx`, `settings-nav.tsx`, and `organization-nav.tsx` components.

---

### Task 1: Add Organization, Membership, MFA, and Avatar Schema

**Files:**
- Create: `packages/db/src/schema/organizations.ts`
- Create: `packages/db/src/schema/media.ts`
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/src/schema/cases.ts`
- Modify: `packages/db/src/schema/assets.ts`
- Modify: `packages/db/src/schema/ai.ts`
- Modify: `packages/db/src/schema/audit.ts`
- Modify: `packages/db/src/schema/evidence.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0004_organization_security_mfa.sql`
- Test: `packages/db/src/client.integration.test.ts`

**Interfaces:**
- Produces: `organizations`, `organizationSecurityPolicies`, `organizationMemberships`, `totpCredentials`, `mfaRecoveryCodes`, `mfaChallenges`, `inviteEnrollments`, `mfaRecoveryEnrollments`, `securityNotifications`, `avatarImages`, and `mediaJobs` Drizzle tables.
- Produces: database invariant `assert_single_active_organization_admin()` as a deferred constraint trigger.
- Consumes: existing `users`, `invites`, `sessions`, root case/asset/policy/audit tables, UUIDv7 IDs, and timestamp helpers.

- [ ] **Step 1: Write migration integration tests that fail before the organization schema exists**

```ts
it("backfills one organization and transfers every existing role", async () => {
  // Insert ADMIN, MEMBER, VIEWER using the pre-migration fixture, run 0004,
  // then assert one organization and one membership per user with identical roles.
});

it("leaves a fresh database without an organization", async () => {
  // Run all migrations with zero users; admin:create must remain the creator.
});

it("rejects a second organization", async () => {
  // Insert the first complete organization/admin transaction, then expect the
  // second singleton_key=1 insert to violate organizations_singleton_key.
});
```

- [ ] **Step 2: Run the focused database tests and observe missing-table or invariant failures**

Run: `bunx vitest --run --project node-integration packages/db/src/client.integration.test.ts`

Expected: FAIL because `organizations` and memberships do not exist.

- [ ] **Step 3: Define organization and policy tables with secure bounds**

```ts
export const organizations = pgTable("organizations", {
  id: primaryId(),
  singletonKey: smallint("singleton_key").notNull().default(1),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationSecurityPolicies = pgTable("organization_security_policies", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  mfaRequired: boolean("mfa_required").notNull().default(true),
  inviteTtlHours: integer("invite_ttl_hours").notNull().default(72),
  sessionIdleMinutes: integer("session_idle_minutes").notNull().default(30),
  sessionAbsoluteHours: integer("session_absolute_hours").notNull().default(12),
  recentMfaMinutes: integer("recent_mfa_minutes").notNull().default(10),
  // The SQL migration adds the users FK after auth tables exist, avoiding an
  // organizations.ts <-> auth.ts module cycle in the Drizzle schema.
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});
```

Add SQL checks: `singleton_key = 1`, `mfa_required`, invite TTL `1..72`, idle `5..120`, absolute `1..24`, recent MFA `5..30`, and nonblank organization name length `2..120` after trimming.

- [ ] **Step 4: Move role authority to memberships and add MFA lifecycle tables**

```ts
export const organizationMemberships = pgTable("organization_memberships", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<UserRole>().notNull(),
  joinedAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.organizationId, table.userId] }), uniqueIndex("organization_memberships_user_key").on(table.userId)]);

export const totpCredentials = pgTable("totp_credentials", {
  id: primaryId(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  keyId: text("key_id").notNull(),
  nonce: text("nonce").notNull(),
  ciphertext: text("ciphertext").notNull(),
  authTag: text("auth_tag").notNull(),
  lastAcceptedCounter: bigint("last_accepted_counter", { mode: "number" }),
  enrolledAt: createdAt(),
  replacedAt: timestampColumn("replaced_at"),
});
```

Add recovery-code rows (`keyId`, `digest`, `usedAt`), hashed challenge rows (`purpose`, `expiresAt`, `attemptCount`, `consumedAt`), pending invite enrollment, and re-enrollment-only recovery capabilities. Store no plaintext secret/code/token column.

Add `security_notifications` with user, organization, event type, non-secret JSON details, occurrence/read timestamps, and an index on unread rows. Recovery/reset events must be representable without embedding tokens, codes, IP addresses, or decoder errors.

- [ ] **Step 5: Add organization ownership to root records and avatar state**

Add non-null `organization_id` to invitations, cases, assets, reference sequences, AI provider policies, and audit events after backfill. Change provider-policy uniqueness to `(organization_id, provider_id)` and reference-sequence uniqueness to `(organization_id, entity_type, year)`. Children inherit organization from their case/asset parent; do not duplicate organization IDs on every child table.

Define avatar state exactly as:

```ts
type AvatarStatus = "AWAITING_UPLOAD" | "QUARANTINED" | "PROCESSING" | "READY" | "REJECTED" | "SUPERSEDED";
type AvatarTarget = "ORGANIZATION" | "USER";
```

Use a target check requiring exactly one of `target_user_id` or `target_organization_id`, opaque quarantine/sanitized keys, declared and observed hashes/sizes, stable rejection code, and partial unique indexes allowing at most one `READY` row per target.

Add `media_jobs` with purpose `AVATAR_SANITIZE | ARTIFACT_INTEGRITY | ARTIFACT_PREVIEW`, target ID, `QUEUED | RUNNING | SUCCEEDED | FAILED` state, attempt count capped at three, lease owner/expiry, stable failure code, and timestamps. It contains opaque object keys and IDs only, never original filenames, secrets, report content, or image bytes. Extend artifact status with `VERIFYING` and `REJECTED`; only `STORED` artifacts may be downloaded, previewed, cited, or sent to AI.

- [ ] **Step 6: Add the singleton and final-active-administrator database constraints**

Create a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on membership insert/update/delete and user disabled-state update. At transaction commit it must count joined memberships where role is `ADMIN` and `users.disabled = false`; if an organization exists and the count is zero, raise SQLSTATE `23514`. This must also protect two administrators racing to demote or disable each other.

- [ ] **Step 7: Implement migration backfill and revoke legacy sessions**

In one migration transaction:

1. Create the organization only when at least one user exists.
2. Backfill membership roles from `users.role`.
3. Backfill root `organization_id` values.
4. Create the bounded default policy.
5. Set `sessions.revoked_at = now()` for every existing session.
6. Drop `users.role` only after membership validation counts match user counts.
7. Abort when existing users contain no active administrator; do not invent an administrator silently.

- [ ] **Step 8: Run schema tests and inspect migration constraints**

Run: `bunx vitest --run --project node-integration packages/db/src/client.integration.test.ts`

Run: `bun run db:migrate`

Expected: PASS; PostgreSQL lists the singleton index and deferred administrator constraint.

- [ ] **Step 9: Commit the schema slice**

```bash
git add packages/db/src/schema packages/db/drizzle/0004_organization_security_mfa.sql packages/db/src/client.integration.test.ts
git commit -m "feat: add organization security schema"
```

### Task 2: Make Organization Membership the Server Authorization Principal

**Files:**
- Create: `packages/core/src/organization.ts`
- Create: `packages/core/src/organization.test.ts`
- Modify: `packages/core/src/permissions.ts`
- Modify: `packages/core/src/permissions.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/server/src/auth/session.ts`
- Modify: `apps/server/src/http/guards.ts`
- Modify: `apps/server/src/services/case-access.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/testing/harness.ts`
- Modify: `apps/server/src/authorization.integration.test.ts`

**Interfaces:**
- Produces: `OrganizationActor { userId, organizationId, role, disabled }`.
- Produces: `requireOrganizationMember`, `requireOrganizationAdmin`, and `requireRecentMfa` guards.
- Produces: authenticated principal containing one active membership and organization.
- Consumes: Task 1 membership and organization-policy tables.

- [ ] **Step 1: Replace old restricted-case expectations with failing organization read tests**

```ts
it("lets every active organization member read a restricted case", async () => {
  const restricted = await createRestrictedCase(owner);
  const response = await harness.app.inject({ method: "GET", url: `/v1/cases/${restricted.id}`, headers: outsider.headers });
  expect(response.statusCode).toBe(200);
});

it("still refuses a viewer mutation", async () => {
  const response = await createFindingAs(viewer, caseId);
  expect(response.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run authorization tests and observe the restricted read returning 404**

Run: `bunx vitest --run --project node-integration apps/server/src/authorization.integration.test.ts`

Expected: FAIL on organization-wide restricted-case visibility.

- [ ] **Step 3: Implement pure organization-aware permission functions**

```ts
export interface OrganizationActor {
  userId: string;
  organizationId: string;
  role: UserRole;
  disabled: boolean;
}

export function canReadCase(user: OrganizationActor, context: CaseAccessContext): boolean {
  return !user.disabled && user.organizationId === context.organizationId;
}
```

Preserve current write behavior: owner and explicit `WRITE` can write; explicit `READ` downgrades; otherwise `ADMIN`/`MEMBER` can write and `VIEWER` cannot. Remove `restricted` from read authorization without deleting the field from case metadata.

- [ ] **Step 4: Resolve sessions through users, memberships, organization, and policy**

Return `null` unless the token is live, the user is enabled, exactly one membership exists, and the organization exists. Include `organizationId`, `organizationName`, role, `mfaVerifiedAt`, session expiry, last seen, and policy-derived idle deadline in `AuthenticatedPrincipal`.

- [ ] **Step 5: Enforce organization ownership in case access and event visibility**

Add `organizationId` to `CaseAccessContext`, filter root list/search queries by the principal organization even though the database enforces a singleton, and simplify `readableCaseFilter` to all cases in that organization. This keeps the boundary explicit and prevents accidental cross-organization leakage if the singleton constraint is ever deliberately removed.

- [ ] **Step 6: Add guard tests for member/admin/recent-MFA boundaries**

Test inactive users, wrong-organization synthetic actors, member admin attempts, and sessions whose `mfaVerifiedAt` is just inside and just outside the policy window. Derive time expectations from fixed literal clocks.

- [ ] **Step 7: Run core and server authorization suites**

Run: `bunx vitest --run packages/core/src/organization.test.ts packages/core/src/permissions.test.ts --project node`

Run: `bunx vitest --run --project node-integration apps/server/src/authorization.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the principal slice**

```bash
git add packages/core apps/server/src/auth/session.ts apps/server/src/http/guards.ts apps/server/src/services/case-access.ts apps/server/src/app.ts apps/server/src/testing/harness.ts apps/server/src/authorization.integration.test.ts
git commit -m "feat: scope authorization to organization membership"
```

### Task 3: Implement Versioned Secret Protection and TOTP Verification

**Files:**
- Create: `apps/server/src/auth/secret-keyring.ts`
- Create: `apps/server/src/auth/secret-keyring.test.ts`
- Create: `apps/server/src/auth/totp.ts`
- Create: `apps/server/src/auth/totp.test.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `.env.example`
- Modify: `apps/server/package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: `SecretKeyring.encrypt(plaintext, aad)`, `decrypt(envelope, aad)`, and `digestRecoveryCode(code, keyId)`.
- Produces: `createTotpEnrollment`, `validateTotpAt`, and `consumeTotpCounter`.
- Consumes: `otpauth@9.5.1`, `node:crypto`, Task 1 credential tables, and injected clocks in tests.

- [ ] **Step 1: Add failing RFC and key-protection tests**

```ts
it.each(RFC_6238_SHA1_VECTORS)("matches RFC 6238 at $unixTime", ({ unixTime, token }) => {
  expect(generateTotpAt(RFC_SECRET, unixTime)).toBe(token);
});

it("rejects a valid code after its counter was consumed", async () => {
  expect(await consumeAt(counter)).toBe(true);
  expect(await consumeAt(counter)).toBe(false);
});

it("fails authentication when AES-GCM AAD is changed", () => {
  const envelope = keyring.encrypt(secret, "totp:user-a");
  expect(() => keyring.decrypt(envelope, "totp:user-b")).toThrow();
});
```

- [ ] **Step 2: Run unit tests and observe missing implementation failures**

Run: `bunx vitest --run apps/server/src/auth/secret-keyring.test.ts apps/server/src/auth/totp.test.ts --project node`

Expected: FAIL because keyring and TOTP modules do not exist.

- [ ] **Step 3: Parse a versioned MFA keyring and fail closed**

Define `MFA_ENCRYPTION_KEYS=v2:<base64-32-bytes>,v1:<base64-32-bytes>`. The first entry encrypts; all entries decrypt. Reject duplicate/invalid IDs, wrong byte lengths, fewer than one key, development placeholder values when `NODE_ENV=production`, and malformed Base64. Redact this environment name from configuration errors and logs.

- [ ] **Step 4: Implement authenticated encryption and key-separated recovery digests**

Use random 96-bit nonces and AES-256-GCM. Bind ciphertext to `totp:<credentialId>:<userId>` or `enrollment:<enrollmentId>:<inviteId>` AAD. Derive the recovery-code HMAC key with HKDF-SHA256 using info `codevault/recovery-code/v1`; compare digests with `timingSafeEqual`.

- [ ] **Step 5: Wrap OTPAuth with fixed server policy**

```ts
const totp = new OTPAuth.TOTP({
  issuer,
  label,
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  secret: OTPAuth.Secret.fromBase32(secretBase32),
});
```

Do not accept algorithm/digits/period/window from a request. Generate a 20-byte secret, percent-encode issuer/label through OTPAuth, validate only numeric six-character tokens, and return the matched absolute counter rather than a Boolean.

- [ ] **Step 6: Atomically consume counters in PostgreSQL**

Use a conditional `UPDATE ... WHERE last_accepted_counter IS NULL OR last_accepted_counter < :counter RETURNING id`. A zero-row result is a generic invalid-MFA response. Add a two-promise integration test proving one success and one rejection for the same token/counter.

- [ ] **Step 7: Add dependency and keyring startup checks**

Pin `otpauth` to `9.5.1` in `apps/server/package.json`; commit the Bun lockfile. `loadConfig` must refuse to start without `MFA_ENCRYPTION_KEYS`. Add an environment verification check that encrypts/decrypts a synthetic value without printing it.

- [ ] **Step 8: Run auth crypto tests and typecheck**

Run: `bunx vitest --run apps/server/src/auth/secret-keyring.test.ts apps/server/src/auth/totp.test.ts --project node`

Run: `bun run --cwd apps/server typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the cryptography slice**

```bash
git add apps/server/src/auth apps/server/src/config.ts apps/server/package.json .env.example bun.lock
git commit -m "feat: add protected TOTP credentials"
```

### Task 4: Bootstrap the Sole Organization and First MFA Administrator

**Files:**
- Modify: `scripts/bootstrap-admin.ts`
- Create: `scripts/bootstrap-admin.test.ts`
- Create: `scripts/rotate-mfa-key.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces: atomic `admin:create --organization` bootstrap.
- Produces: `mfa:rotate-key` batch re-encryption command.
- Consumes: Task 1 schema and final-admin constraint, Task 3 keyring/TOTP helpers, password hashing, audit events.

- [ ] **Step 1: Extract CLI parsing and write failing behavior tests**

Test missing `--organization`, blank names, existing organization, password mismatch, invalid TOTP, successful bootstrap, and interrupted enrollment. The unsuccessful cases must assert zero organization/user/membership rows, not only a nonzero exit code.

- [ ] **Step 2: Run bootstrap tests and observe the parser/transaction failures**

Run: `bunx vitest --run scripts/bootstrap-admin.test.ts --project node-integration`

Expected: FAIL because organization and TOTP bootstrap are absent.

- [ ] **Step 3: Implement pre-transaction password and TOTP enrollment**

Generate the TOTP secret in memory, print a manual Base32 key plus local `otpauth://` URI, and prompt for one token. Do not invoke a remote QR service. Zero references to the secret after transaction completion; never print it again.

- [ ] **Step 4: Commit organization, policy, admin user, membership, encrypted credential, recovery digests, and audit atomically**

Only enter the database transaction after password and TOTP validation. Inside it, recheck that no organization exists, create every required row, and print ten recovery codes once after commit. If stdout is not a TTY, require `--allow-noninteractive-secret-output` before printing recovery material.

- [ ] **Step 5: Implement resumable key rotation without plaintext output**

`mfa:rotate-key` must decrypt each active credential with its recorded key ID, re-encrypt using the first configured key, update only when the old key ID still matches, process batches of 100, and report counts only. A dry run reports key IDs/counts without decrypting values.

- [ ] **Step 6: Run bootstrap and rotation tests**

Run: `bunx vitest --run scripts/bootstrap-admin.test.ts --project node-integration`

Expected: PASS, including zero partial rows after invalid enrollment and decryptability after rotation.

- [ ] **Step 7: Commit the bootstrap slice**

```bash
git add scripts/bootstrap-admin.ts scripts/bootstrap-admin.test.ts scripts/rotate-mfa-key.ts package.json README.md
git commit -m "feat: bootstrap organization administrator with MFA"
```

### Task 5: Build Invitation Onboarding and Mandatory MFA Enrollment APIs

**Files:**
- Modify: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/organization.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/auth/enrollment-routes.ts`
- Create: `apps/server/src/auth/mfa-challenges.ts`
- Create: `apps/server/src/auth/mfa-challenges.test.ts`
- Modify: `apps/server/src/modules/auth/routes.ts`
- Modify: `apps/server/src/modules/users/routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/auth.integration.test.ts`

**Interfaces:**
- Produces: `POST /v1/invitations/inspect`, `/v1/invitations/enrollment/start`, and `/v1/invitations/enrollment/confirm`.
- Produces: `InviteInspection`, `TotpEnrollment`, and `RecoveryCodeBundle` contracts.
- Consumes: Task 1 invitation enrollment tables, Task 3 keyring/TOTP, existing Argon2 password functions, and administrator guards.

- [ ] **Step 1: Write failing end-to-end onboarding tests**

```ts
it("creates no account until TOTP confirmation succeeds", async () => {
  const started = await startEnrollment(inviteToken, profileAndPassword);
  expect(await countUsersByEmail(invitedEmail)).toBe(0);
  await expectConfirm(started.enrollmentToken, "000000", 400);
  expect(await countUsersByEmail(invitedEmail)).toBe(0);
});

it("consumes the invitation and returns recovery codes exactly once", async () => {
  const confirmed = await confirmWithCurrentTotp();
  expect(confirmed.recoveryCodes).toHaveLength(10);
  await expectConfirmAgain(400);
  expect(await storedPlaintextRecoveryCodeCount()).toBe(0);
});
```

Also cover expired/revoked/accepted invites, two concurrent confirmations, wrong token, an existing email, enrollment expiry, password-policy failure, and response/log/audit redaction.

- [ ] **Step 2: Run the auth integration tests and observe missing-route failures**

Run: `bunx vitest --run --project node-integration apps/server/src/auth.integration.test.ts`

Expected: FAIL with 404 for the onboarding routes.

- [ ] **Step 3: Add strict contracts and public-route registration**

Use POST bodies rather than query strings for every invitation/enrollment token so secrets do not enter URLs, history, or proxy logs. Add all three exact paths to `PUBLIC_ROUTES`; keep rate limits at 10/minute per source and add database attempt limits per invitation/enrollment.

- [ ] **Step 4: Implement minimal invite inspection**

Return organization name and sanitized-avatar ID, invited email, assigned role, and expiry. Return the same generic invalid response for missing, revoked, accepted, and expired tokens. Never return creator email, internal IDs other than the public enrollment target, or whether an account already exists.

- [ ] **Step 5: Start a 15-minute pending enrollment**

Hash the password before the transaction. Under `SELECT ... FOR UPDATE` on the invitation, replace any expired pending enrollment, generate a 20-byte TOTP secret and 256-bit opaque enrollment token, encrypt the secret with enrollment AAD, store only the token hash, and return `{ enrollmentToken, provisioningUri, manualSecret, expiresAt }` once.

- [ ] **Step 6: Confirm TOTP and activate every identity row in one transaction**

Lock enrollment and invite, increment failed attempts before returning an error, validate a counter, recheck expiry/email uniqueness, create user plus membership, re-encrypt the secret under credential AAD, create recovery digests, mark invitation accepted, consume enrollment, and append an organization-scoped audit event. Five failed confirmation attempts invalidate the pending enrollment but leave the original invitation usable until its own expiry.

- [ ] **Step 7: Move invitation administration under organization paths**

Replace write APIs with `GET/POST /v1/organization/invitations` and `DELETE /v1/organization/invitations/:id`. Reads require membership; token creation/revocation requires administrator plus recent MFA. The raw invitation token remains a one-time response.

- [ ] **Step 8: Run onboarding tests and verify logs contain no enrollment material**

Run: `bunx vitest --run --project node-integration apps/server/src/auth.integration.test.ts`

Run a test logger capture and assert it excludes the known token, Base32 secret, provisioning URI, password, TOTP, and recovery-code sentinel values.

Expected: PASS.

- [ ] **Step 9: Commit the onboarding slice**

```bash
git add packages/contracts apps/server/src/modules/auth apps/server/src/auth/mfa-challenges.ts apps/server/src/auth/mfa-challenges.test.ts apps/server/src/modules/users/routes.ts apps/server/src/app.ts apps/server/src/auth.integration.test.ts
git commit -m "feat: add invitation MFA onboarding"
```

### Task 6: Require MFA Challenges for Login, Step-Up, and Recovery

**Files:**
- Create: `apps/server/src/modules/auth/login-routes.ts`
- Create: `apps/server/src/modules/auth/recovery-routes.ts`
- Modify: `apps/server/src/modules/auth/routes.ts`
- Modify: `apps/server/src/auth/login-throttle.ts`
- Modify: `apps/server/src/auth/session.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `apps/server/src/auth.integration.test.ts`
- Create: `apps/server/src/mfa-security.integration.test.ts`

**Interfaces:**
- Produces: `POST /v1/auth/login/start`, `/v1/auth/login/complete`, `/v1/auth/step-up`, `/v1/auth/recovery/start`, and `/v1/auth/recovery/confirm`.
- Produces: login challenge union `MFA_REQUIRED | ENROLLMENT_REQUIRED`; only completion returns `LoginResponse` with a session token.
- Consumes: Task 3 TOTP/recovery verification, Task 5 enrollment, organization policy, and session store.

- [ ] **Step 1: Write failing session-issuance and bypass tests**

Test all of these as separate behaviors:

```ts
it("stores no session after password-only success", async () => {});
it("rejects a challenge after five failed MFA codes", async () => {});
it("accepts one concurrent use of a TOTP counter", async () => {});
it("rejects a challenge for a user disabled after password verification", async () => {});
it("throttles new challenges after account/source and global account TOTP limits", async () => {});
it("recovery code starts re-enrollment and never returns a session", async () => {});
it("requires the next TOTP step for step-up after login code consumption", async () => {});
```

- [ ] **Step 2: Run MFA security tests and observe password-only session creation**

Run: `bunx vitest --run --project node-integration apps/server/src/mfa-security.integration.test.ts`

Expected: FAIL because the current login route creates a session directly.

- [ ] **Step 3: Split password and MFA phases**

Password success creates a five-minute, 256-bit challenge token stored only as SHA-256. Keep the raw challenge in Electron main. Use a fixed generic password failure, retain constant-work password verification for missing accounts, and record `PASSWORD`, `TOTP`, `RECOVERY`, and `ENROLLMENT` attempt factors separately. Apply both account/source and account-wide TOTP windows so IP rotation cannot bypass the limit; use increasing delays before the temporary lock threshold to reduce attacker-driven lockout.

- [ ] **Step 4: Complete login in one replay-safe transaction**

Lock challenge and credential; check purpose, expiry, consumed state, attempts, user enabled state, membership, and policy. Validate TOTP; atomically advance `lastAcceptedCounter`; consume challenge; create session with `mfaVerifiedAt = now()` and `mfaMethod = "TOTP"`; clear only successful factor attempts; audit without codes or challenge tokens.

- [ ] **Step 5: Enforce session idle and absolute bounds**

Set absolute expiry from organization policy at session creation. Reject `lastSeenAt` older than `sessionIdleMinutes`. Touch read and write sessions at most once every five minutes so active read-only researchers do not expire while avoiding one database update per request.

- [ ] **Step 6: Add step-up MFA for sensitive operations**

`POST /v1/auth/step-up` verifies a fresh, not-yet-consumed counter and updates the current session’s `mfaVerifiedAt`. `requireRecentMfa` returns a stable `MFA_REAUTH_REQUIRED` category when outside the policy window. Never satisfy step-up with password or recovery code.

- [ ] **Step 7: Make recovery re-enrollment-only**

Password plus a valid unused recovery code atomically consumes that code, revokes all sessions, replaces any previous recovery enrollment, and returns a 15-minute re-enrollment token plus new TOTP provisioning material. Administrator reset follows the same state machine. Only new TOTP confirmation issues a full session and ten new recovery codes.

- [ ] **Step 8: Add security event notifications**

Insert an immutable `securityNotifications` record for recovery use, administrator reset, TOTP replacement, password change, and new recovery codes. Show it to the user on the next successful sign-in and in `/settings/security`; show recovery/reset events to administrators immediately through the existing event broker. Do not claim email notification until a verified delivery connector exists.

- [ ] **Step 9: Run all auth and concurrency tests**

Run: `bunx vitest --run --project node-integration apps/server/src/auth.integration.test.ts apps/server/src/mfa-security.integration.test.ts`

Expected: PASS, with exactly one session and one accepted counter under concurrent duplicate submission.

- [ ] **Step 10: Commit the login/recovery slice**

```bash
git add apps/server/src/modules/auth apps/server/src/auth apps/server/src/auth.integration.test.ts apps/server/src/mfa-security.integration.test.ts packages/contracts/src/auth.ts
git commit -m "feat: require MFA for session issuance and recovery"
```

### Task 7: Add Organization and Self-Service APIs with Final-Admin Safety

**Files:**
- Create: `apps/server/src/modules/organization/routes.ts`
- Create: `apps/server/src/modules/organization/service.ts`
- Create: `apps/server/src/modules/organization/queries.ts`
- Create: `apps/server/src/modules/settings/routes.ts`
- Modify: `apps/server/src/modules/users/routes.ts`
- Modify: `apps/server/src/modules/ai/routes.ts`
- Modify: `apps/server/src/routes.ts`
- Create: `apps/server/src/organization.integration.test.ts`
- Modify: `packages/contracts/src/organization.ts`
- Modify: `packages/contracts/src/auth.ts`

**Interfaces:**
- Produces: read APIs for every member and mutation APIs guarded by admin/recent MFA.
- Produces: `updateMembershipRole`, `setUserDisabled`, and `resetUserMfa` services using row locks and the database invariant.
- Consumes: Task 2 principal/guards and Task 6 step-up/recovery.

- [ ] **Step 1: Write a route authorization matrix as failing integration tests**

For each endpoint, test `ADMIN recent`, `ADMIN stale`, `MEMBER`, `VIEWER`, disabled user, and unauthenticated caller. Cover:

```text
GET   /v1/organization/users
GET   /v1/organization/users/:id
GET   /v1/organization/settings
PATCH /v1/organization/settings
GET   /v1/organization/security
PATCH /v1/organization/security
PATCH /v1/organization/users/:id
POST  /v1/organization/users/:id/mfa-reset
PATCH /v1/settings/profile
POST  /v1/settings/password
GET   /v1/settings/sessions
DELETE /v1/settings/sessions/:id
```

- [ ] **Step 2: Run organization integration tests and observe missing routes**

Run: `bunx vitest --run --project node-integration apps/server/src/organization.integration.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement member-readable organization projections**

Directory rows expose avatar ID, display name, email, role, joined date, disabled state, and last login. User detail adds authored case/finding/report counts plus recent audit activity already visible to the organization. Individual MFA enrollment/reset state is administrator-only; ordinary members see only the global rule that MFA is mandatory.

- [ ] **Step 4: Implement bounded organization settings and security policy updates**

Allow name and the five numeric policy values from Task 1. Reject unknown keys and attempts to set `mfaRequired: false`. Require admin plus recent MFA. Revoke sessions whose lifetime now exceeds tightened bounds, and audit before/after values without secret configuration.

- [ ] **Step 5: Centralize user/membership mutation under locks**

Lock the target user, all administrator memberships, and organization policy. Reject self-disable/self-demotion with a friendly validation error, but rely on the deferred database trigger for races and non-route callers. Revoke all target sessions on disablement, role change, password reset, or MFA reset.

- [ ] **Step 6: Scope AI policy to organization and recent MFA**

All members may read effective provider policy. Only recent-MFA admins may change it. Include `organization_id` in every query/upsert conflict target and audit event. Remove “workspace” copy in favor of “organization.”

- [ ] **Step 7: Implement strictly personal settings routes**

Profile accepts only the caller’s display name. Password change requires current password plus recent TOTP step-up and revokes every other session. Session deletion permits the caller’s sessions only; deleting current session signs out. TOTP rotation enters Task 6 re-enrollment and never exposes another user’s credential.

- [ ] **Step 8: Prove the final-admin race fails safely**

Use two database connections and a barrier: admin A demotes B while B disables A. Commit concurrently. Assert one transaction fails with the domain-mapped final-admin error and the database retains at least one active administrator.

- [ ] **Step 9: Run organization and AI policy tests**

Run: `bunx vitest --run --project node-integration apps/server/src/organization.integration.test.ts apps/server/src/ai-security.integration.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit the organization API slice**

```bash
git add apps/server/src/modules/organization apps/server/src/modules/settings apps/server/src/modules/users apps/server/src/modules/ai/routes.ts apps/server/src/routes.ts apps/server/src/organization.integration.test.ts packages/contracts
git commit -m "feat: add organization and personal settings APIs"
```

### Task 8: Implement One-Time Avatar Ingestion and State Transitions

**Files:**
- Create: `packages/contracts/src/media.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/avatars/routes.ts`
- Create: `apps/server/src/modules/avatars/service.ts`
- Create: `apps/server/src/modules/avatars/service.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/routes.ts`
- Modify: `apps/server/src/services/storage.ts`
- Modify: `apps/server/src/plugins/types.ts`
- Create: `apps/server/src/avatar-upload.integration.test.ts`

**Interfaces:**
- Produces: `POST /v1/avatar-uploads`, `PUT /v1/avatar-uploads/:id/content`, `GET /v1/avatars/:id/content`, and `DELETE /v1/avatars/current`.
- Produces: `AvatarUploadRequest`, `AvatarUpload`, and stable rejection codes.
- Consumes: Task 1 avatar/media-job rows, Task 2 authorization, and private object storage.

- [ ] **Step 1: Write failing authorization, size, state, and content tests**

Test member self-avatar success, member organization-avatar denial, recent-MFA admin organization upload, another-user target denial, declared size zero/over 5 MiB, wrong `Content-Length`, body exceeding limit, repeated PUT, content after expiry, and raw object retrieval denial.

- [ ] **Step 2: Run upload tests and observe missing routes**

Run: `bunx vitest --run --project node-integration apps/server/src/avatar-upload.integration.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Register a route-scoped binary parser with a hard cap**

Accept only `application/octet-stream` on the exact avatar content route. Reject chunked requests without a declared length, lengths above `5 * 1024 * 1024`, bodies whose observed bytes differ, and any parser output other than `Buffer`. Do not raise the global JSON body limit.

- [ ] **Step 4: Create uploads with server-owned opaque keys**

The JSON start request contains target, original filename for display-only audit metadata (max 255 UTF-8 code points), declared size, and lowercase SHA-256. The server ignores extension/MIME for security decisions and generates `quarantine/avatars/<uuidv7>` without the filename.

- [ ] **Step 5: Stream once through the authenticated API and hash server-side**

Write to storage while computing SHA-256; if the storage abstraction cannot stream, buffer remains bounded by 5 MiB. Compare observed hash/size to the start declaration using constant-time digest comparison. On mismatch delete the object and mark `REJECTED` with `INTEGRITY_MISMATCH`.

- [ ] **Step 6: Make the upload state machine conditional and idempotent**

Every transition uses `UPDATE ... WHERE status = :expected RETURNING`. Only `AWAITING_UPLOAD → QUARANTINED` queues one media job. Repeated content PUT, worker completion, cancellation, and timeout cannot publish twice or replace an existing current avatar.

- [ ] **Step 7: Serve only authenticated sanitized derivatives**

`GET /v1/avatars/:id/content` requires active organization membership, requires status `READY`, reads only `sanitizedObjectKey`, sends `Content-Type: image/webp`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, private cache headers with ETag/version, and a fixed maximum response size. No route serves quarantine keys.

- [ ] **Step 8: Add expiry cleanup and audit behavior**

Expire `AWAITING_UPLOAD` after 15 minutes and `QUARANTINED/PROCESSING` after the worker timeout. Cleanup deletes quarantine bytes, records a stable status, and never includes native error text in an audit record.

- [ ] **Step 9: Run avatar API tests**

Run: `bunx vitest --run --project node-integration apps/server/src/avatar-upload.integration.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit the ingestion slice**

```bash
git add packages/contracts/src/media.ts packages/contracts/src/index.ts apps/server/src/modules/avatars apps/server/src/app.ts apps/server/src/routes.ts apps/server/src/services/storage.ts apps/server/src/plugins/types.ts apps/server/src/avatar-upload.integration.test.ts
git commit -m "feat: add quarantined avatar ingestion"
```

### Task 9: Isolate Image Decoding and Harden Existing Evidence Previews

**Files:**
- Create: `apps/media-worker/package.json`
- Create: `apps/media-worker/tsconfig.json`
- Create: `apps/media-worker/src/index.ts`
- Create: `apps/media-worker/src/claim-job.ts`
- Create: `apps/media-worker/src/sanitize-image.ts`
- Create: `apps/media-worker/src/sanitize-image.test.ts`
- Create: `apps/media-worker/src/worker.integration.test.ts`
- Create: `packages/db/drizzle/0005_media_worker_least_privilege.sql`
- Modify: `packages/contracts/src/evidence.ts`
- Modify: `apps/server/src/modules/evidence/routes.ts`
- Modify: `apps/server/src/services/storage.ts`
- Modify: `apps/server/src/testing/harness.ts`
- Modify: `apps/desktop/src/main/file-uploads.ts`
- Modify: `apps/desktop/src/preload/contracts.ts`
- Modify: `apps/worker/src/jobs/artifact-preview.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/package.json`
- Modify: `scripts/dev.ts`
- Create: `infra/media-worker.Dockerfile`
- Create: `docs/operations/media-worker-security.md`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: `sanitizeImage(input: Uint8Array): Promise<SanitizedImage>` with fixed JPEG/PNG input and WebP output policy.
- Produces: database functions `claim_media_job`, `complete_media_job`, and `fail_media_job` executable by a no-login owner role and a least-privilege runtime role.
- Produces: checksum-bound S3 instructions and streaming post-upload integrity verification before artifact availability.
- Consumes: Task 1 `mediaJobs`/`avatarImages`, existing artifact preview columns, `sharp@0.35.3+`, and prefix-limited object storage.

- [ ] **Step 1: Add a safe adversarial fixture corpus and failing sanitizer tests**

Store generated, non-exploit fixtures under `apps/media-worker/src/testing/fixtures/`: valid JPEG, valid PNG, truncated JPEG, malformed PNG, 20-megapixel PNG header, APNG with two frames, GIF renamed `.png`, SVG renamed `.png`, WebP input, PNG with a trailing `<script>` sentinel, and JPEG with EXIF/GPS/comment metadata.

```ts
it("accepts a valid PNG and emits only bounded WebP pixels", async () => {});
it("rejects SVG before a decoder can select its loader", async () => {});
it("rejects APNG because it contains more than one page", async () => {});
it("strips EXIF, GPS, comments, ICC profiles, and trailing bytes", async () => {});
it("rejects a decompression bomb before exceeding the pixel budget", async () => {});
```

Tests assert stable codes such as `UNSUPPORTED_FORMAT`, `MALFORMED_IMAGE`, `TOO_MANY_PIXELS`, `TOO_MANY_FRAMES`, and `PROCESSING_LIMIT`, never the exact native error message.

- [ ] **Step 2: Run media tests and observe the missing sanitizer failure**

Run: `bunx vitest --run apps/media-worker/src/sanitize-image.test.ts --project node`

Expected: FAIL because the media worker does not exist.

- [ ] **Step 3: Pin and verify the patched native dependency before decoding**

Pin exact `sharp` version `0.35.3` or a newer reviewed 0.35.x release and commit the lockfile. At worker startup, parse `sharp.versions.vips`; refuse readiness below 8.18.3. Add a unit test with injected version strings and an operations command that prints versions only, never environment values.

- [ ] **Step 4: Block every loader and reopen only JPEG/PNG buffers**

```ts
process.env.VIPS_BLOCK_UNTRUSTED = "1";
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({ operation: [
  "VipsForeignLoadJpegBuffer",
  "VipsForeignLoadPngBuffer",
] });
sharp.cache(false);
sharp.concurrency(1);
```

Set this before constructing any sharp instance. Never unblock file loaders, SVG, GIF, TIFF, PDF, HEIF, AVIF, Magick, text, URL, or VIPS-native loaders.

- [ ] **Step 5: Verify magic independently, then decode with strict bounds**

Implement a small exact signature check for JPEG SOI and the eight-byte PNG signature. Construct sharp from a `Buffer` only with `failOn: "warning"`, `limitInputPixels: 16_000_000`, `limitInputChannels: 4`, `pages: 1`, `animated: false`, and `unlimited: false`. Read metadata and reject format mismatch, width/height over 8192, page count other than one, and channels outside three/four.

- [ ] **Step 6: Re-encode to fixed WebP and inspect returned output info**

Auto-orient, resize within 512×512 without enlargement, convert to sRGB, and call `.webp({ quality: 82, alphaQuality: 90, effort: 4 })` without any metadata-preservation option. Use `toBuffer({ resolveWithObject: true })`; require `info.format === "webp"`, dimensions `1..512`, output under 512 KiB, and RIFF/WEBP magic. Scan the output for the known metadata/script fixture sentinels and fail the test if any survive.

- [ ] **Step 7: Add hard process and job limits**

One process handles one image at a time. Lease duration is 30 seconds; sanitizer deadline is 10 seconds; maximum attempts is three for transient storage failures and one for deterministic parse rejection. On timeout, terminate the process and mark `PROCESSING_LIMIT`. Do not retry malformed or unsupported content.

- [ ] **Step 8: Expose only security-definer job functions to the media database role**

Create a no-login owner for three `SECURITY DEFINER` functions. Each function uses a fixed `SET search_path = pg_catalog, public`, schema-qualified tables, lease tokens, expected-state updates, and bounded arguments. Revoke all table/schema privileges and function execution from `PUBLIC`; grant the runtime role only connect plus execute on these functions. An integration test must prove the media role cannot select `users`, `cases`, `findings`, `audit_events`, or arbitrary `media_jobs` rows.

- [ ] **Step 9: Complete jobs atomically through the narrow database functions**

For avatars, `complete_media_job` validates the sanitized key prefix/hash/dimensions, marks the prior current row `SUPERSEDED`, marks the new row `READY`, and inserts an audit event attributed to `requestedBy`. For evidence, it updates only preview kind/key and leaves the original untouched. `fail_media_job` records only the stable failure code and schedules quarantine deletion.

- [ ] **Step 10: Bind large evidence uploads to signed per-object and per-part checksums**

For single PUT, include signed `ContentLength`, `ContentType`, and `ChecksumSHA256`; return the exact required headers in `UploadInstructions`. For multipart, make the main process compute every 32 MiB part SHA-256 while it performs the existing whole-file hash, send the bounded checksum list when starting the upload, create the multipart upload with `ChecksumAlgorithm: "SHA256"`, and sign each `UploadPart` URL with its part checksum. Completion sends each ETag plus checksum. A leaked/reused URL can then upload only bytes matching the signed digest and size.

- [ ] **Step 11: Keep artifacts unavailable until a streaming full digest succeeds**

After object-size confirmation, set artifact status to `VERIFYING` and enqueue `ARTIFACT_INTEGRITY`, not preview. Add `ObjectStorage.getObjectStream` and hash the stream without buffering, including 10 GiB fixtures represented by generated streams in tests. If the full SHA-256 differs, set `REJECTED`, delete the object, and audit `artifact.integrity_rejected`. Only a match sets `STORED` and enqueues `ARTIFACT_PREVIEW`.

- [ ] **Step 12: Move evidence previews to the same allow-listed sanitizer**

Replace the current MIME-driven decoder branch. Only observed JPEG/PNG signatures receive thumbnails; GIF, WebP, BMP, TIFF, and AVIF originals remain download-only with `previewKind: "NONE"`. Remove sharp from `apps/worker` after no remaining import exists. Keep text preview logic in the normal worker because it has no native decoder.

- [ ] **Step 13: Build the least-privilege runtime container**

Run as numeric non-root UID, read-only root filesystem, writable size-capped `/tmp` tmpfs, `cap_drop: ALL`, `no-new-privileges`, PID limit 32, memory limit 256 MiB, one CPU, and a seccomp profile that denies process creation after startup, ptrace, mount, and raw sockets. Permit egress only to PostgreSQL and the private object-store endpoint. Give S3 credentials read/delete on quarantine/artifact input prefixes and put/delete on preview/avatar derivative prefixes; deny bucket listing and every other prefix.

- [ ] **Step 14: Run sanitizer, least-privilege, and evidence regression tests**

Run: `bunx vitest --run apps/media-worker/src/sanitize-image.test.ts --project node`

Run: `bunx vitest --run apps/media-worker/src/worker.integration.test.ts --project node-integration`

Run: `bunx vitest --run --project node-integration apps/server/src/evidence.integration.test.ts apps/server/src/avatar-upload.integration.test.ts`

Expected: PASS; unsupported formats create no derivative, valid JPEG/PNG output is fixed WebP, and the media role cannot read application tables.

- [ ] **Step 15: Commit the contained media slice**

```bash
git add apps/media-worker packages/contracts/src/evidence.ts apps/server/src/modules/evidence/routes.ts apps/server/src/services/storage.ts apps/server/src/testing/harness.ts apps/desktop/src/main/file-uploads.ts apps/desktop/src/preload/contracts.ts apps/worker packages/db/drizzle/0005_media_worker_least_privilege.sql scripts/dev.ts infra/media-worker.Dockerfile docs/operations/media-worker-security.md package.json bun.lock
git commit -m "feat: contain and sanitize untrusted images"
```

### Task 10: Update Electron Authentication and Invitation Onboarding

**Files:**
- Modify: `apps/desktop/src/preload/contracts.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/api-client.ts`
- Modify: `apps/desktop/src/main/session-store.ts`
- Modify: `apps/desktop/src/renderer/src/app.tsx`
- Modify: `apps/desktop/src/renderer/src/features/auth/login-screen.tsx`
- Create: `apps/desktop/src/renderer/src/features/auth/mfa-challenge.tsx`
- Create: `apps/desktop/src/renderer/src/features/auth/invite-onboarding.tsx`
- Create: `apps/desktop/src/renderer/src/features/auth/recovery-codes.tsx`
- Create: `apps/desktop/src/renderer/src/features/auth/auth-flow.test.tsx`
- Modify: `apps/desktop/package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: narrow preload operations `auth.beginLogin`, `auth.completeMfa`, `auth.beginInvite`, `auth.confirmInvite`, `auth.beginRecovery`, and `auth.confirmRecoveryEnrollment`.
- Produces: signed-out state machine `LOGIN | MFA | INVITE_PROFILE | INVITE_TOTP | RECOVERY_CODES | RECOVERY_ENROLLMENT`.
- Consumes: Task 5/6 API contracts and `qrcode.react@4.2.0` Canvas renderer.

- [ ] **Step 1: Write failing renderer tests for every signed-out transition**

Test password → MFA, invitation inspect → profile → QR/manual key → confirmation → recovery codes, expired invitation restart, wrong TOTP without losing enrollment, migrated-user enrollment, recovery-code re-enrollment, and cancel clearing all secret-bearing component state.

- [ ] **Step 2: Run the DOM tests and observe the missing flow failures**

Run: `bunx vitest --run apps/desktop/src/renderer/src/features/auth/auth-flow.test.tsx --project dom`

Expected: FAIL because login is currently one screen and one request.

- [ ] **Step 3: Keep raw login/MFA challenges in Electron main only**

The API client receives the raw password challenge and stores it in an in-memory `PendingAuthentication` object containing server origin, purpose, and expiry. The renderer receives only `{ purpose, expiresAt, availableMethods }`. Clear it on success, cancel, expiry, server-origin change, sign-out, and process exit. Never persist it in `SessionStore` or localStorage.

- [ ] **Step 4: Make the renderer-to-main auth bridge operation-specific**

Remove the old single-call `auth.login`. Each IPC handler validates its exact payload lengths/types and trusted sender. The renderer cannot provide an API path, server origin after the flow starts, user ID, challenge token, TOTP policy, session TTL, or recovery target.

- [ ] **Step 5: Build a clear two-stage login UI**

The first screen collects server/email/password. The second collects one six-digit code and states: “Authenticator codes protect against password theft but can still be phished. Verify that you are signing in to the intended CodeVault server.” Provide recovery as a separate “Lost authenticator” action, not a second input on the normal form.

- [ ] **Step 6: Build the invited-user registration experience**

Allow pasting an invitation token or receiving it from a future deep link without adding public registration. Show organization name/email/role before collecting display name and password. Render the provisioning URI only through `<QRCodeCanvas value={uri}>`; never fetch a QR image or inject SVG/HTML. Show the manual secret with an explicit shoulder-surfing warning.

- [ ] **Step 7: Display recovery codes once with deliberate acknowledgement**

Render ten codes, support explicit copy and print actions, warn that clipboard/print destinations may retain them, and require the user to confirm storage before leaving. Do not write them to logs, localStorage, query cache, crash metadata, analytics, or a default file. Unmount clears the array.

- [ ] **Step 8: Prevent session persistence before full MFA success**

Only `completeMfa` or confirmed re-enrollment may call `sessionStore.save`. Password start, TOTP enrollment start, recovery-code use, and administrator reset never write a bearer session token.

- [ ] **Step 9: Run renderer, IPC, and session-store tests**

Run: `bunx vitest --run apps/desktop/src/renderer/src/features/auth/auth-flow.test.tsx --project dom`

Run: `bunx vitest --run apps/desktop/src/main --project node`

Expected: PASS, including a test that scans serialized session storage and renderer localStorage for challenge/enrollment/recovery sentinels.

- [ ] **Step 10: Commit the desktop auth slice**

```bash
git add apps/desktop/src/preload apps/desktop/src/main apps/desktop/src/renderer/src/app.tsx apps/desktop/src/renderer/src/features/auth apps/desktop/package.json bun.lock
git commit -m "feat: add secure MFA onboarding flow"
```

### Task 11: Split Organization and Personal Settings UI and Add Safe Avatars

**Files:**
- Modify: `apps/desktop/src/renderer/src/router.tsx`
- Modify: `apps/desktop/src/renderer/src/components/app-sidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/misc.tsx`
- Create: `apps/desktop/src/renderer/src/routes/organization-users.tsx`
- Create: `apps/desktop/src/renderer/src/routes/organization-settings.tsx`
- Create: `apps/desktop/src/renderer/src/routes/organization-security.tsx`
- Create: `apps/desktop/src/renderer/src/routes/personal-profile.tsx`
- Create: `apps/desktop/src/renderer/src/routes/personal-appearance.tsx`
- Create: `apps/desktop/src/renderer/src/routes/personal-security.tsx`
- Create: `apps/desktop/src/renderer/src/components/organization-nav.tsx`
- Create: `apps/desktop/src/renderer/src/components/settings-nav.tsx`
- Create: `apps/desktop/src/renderer/src/components/avatar.tsx`
- Modify: `apps/desktop/src/preload/contracts.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/api-client.ts`
- Create: `apps/desktop/src/main/avatar-uploads.ts`
- Create: `apps/desktop/src/main/avatar-uploads.test.ts`
- Create: `apps/desktop/src/renderer/src/routes/settings-routes.test.tsx`

**Interfaces:**
- Produces: exact categorized routes with no `/organization` component.
- Produces: preload `avatars.selectAndUpload(target)` and `avatars.load(avatarId, version)` operations.
- Consumes: Task 7 organization/self-service APIs and Task 8 sanitized avatar content.

- [ ] **Step 1: Write failing route and permission rendering tests**

Assert that every role sees organization users/settings/security navigation and read projections; only admins see invite, role, disable, MFA-reset, organization-name/avatar, policy, and AI mutation controls. Assert direct rendering as a member still cannot submit mutations because server tests cover enforcement.

- [ ] **Step 2: Run DOM tests and observe the monolithic settings mismatch**

Run: `bunx vitest --run apps/desktop/src/renderer/src/routes/settings-routes.test.tsx --project dom`

Expected: FAIL because the categorized routes do not exist.

- [ ] **Step 3: Define exact routes and legacy redirects**

Register `/organization/users`, `/organization/users/$userId`, `/organization/settings`, `/organization/security`, `/settings/profile`, `/settings/appearance`, and `/settings/security`. Do not register `/organization`. Make `/settings` and `/settings/account` redirect to `/settings/profile` without rendering the old combined screen.

- [ ] **Step 4: Split settings by ownership boundary**

Personal appearance owns local theme only. Personal profile owns caller name/avatar. Personal security owns password, TOTP rotation, recovery-code replacement, security notifications, and session list. Organization settings owns name/avatar and AI provider policy. Organization security owns immutable MFA-required status plus bounded session/invite/recent-MFA rules.

- [ ] **Step 5: Build organization user directory and detail activity**

All members see avatar, display name, email, role, joined date, disabled status, last login, authored counts, and visible recent activity. Only admins receive per-user MFA status and mutation actions. Require confirmation dialogs for disable, role change, session revocation, and MFA reset; show that reset revokes access and forces re-enrollment.

- [ ] **Step 6: Add a dedicated native avatar picker**

Use Electron `dialog.showOpenDialog` with one-selection JPEG/PNG filters. After selection, require a regular file, reject symbolic links, cap 5 MiB before reading, stream SHA-256, and send no absolute path to the renderer. Re-stat inode/device/size immediately before upload and abort if changed to reduce local TOCTOU.

- [ ] **Step 7: Keep avatar binary transport in main**

Main starts the upload, streams the file to the exact content endpoint, and polls status with cancellation. The renderer receives progress plus upload ID/status only. For display, main fetches authenticated sanitized content, requires `image/webp`, `nosniff`, RIFF/WEBP magic, and at most 512 KiB, then returns a data URL. Cache by `(avatarId, version)` and clear on sign-out.

- [ ] **Step 8: Make pending/rejected avatar UX explicit**

Keep the prior avatar visible during quarantine/processing. Show stable user-facing errors for unsupported format, malformed image, excessive dimensions, integrity mismatch, processing limit, and expired upload. Never display decoder messages, object keys, local paths, or stack traces.

- [ ] **Step 9: Run desktop settings and avatar tests**

Run: `bunx vitest --run apps/desktop/src/main/avatar-uploads.test.ts --project node`

Run: `bunx vitest --run apps/desktop/src/renderer/src/routes/settings-routes.test.tsx --project dom`

Expected: PASS.

- [ ] **Step 10: Commit the categorized UI slice**

```bash
git add apps/desktop/src/renderer/src/router.tsx apps/desktop/src/renderer/src/components apps/desktop/src/renderer/src/routes apps/desktop/src/preload apps/desktop/src/main
git commit -m "feat: add organization and personal settings screens"
```

### Task 12: Migration Drill, Security Regression Gate, and Operational Readiness

**Files:**
- Modify: `docs/architecture/threat-model.md`
- Modify: `docs/architecture/data-model.md`
- Create: `docs/architecture/organization-security.md`
- Create: `docs/operations/mfa-key-management.md`
- Modify: `docs/operations/media-worker-security.md`
- Modify: `README.md`
- Modify: `scripts/verify-env.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `infra/docker-compose.yml`
- Modify: `infra/server.Dockerfile`
- Modify: `infra/worker.Dockerfile`
- Modify: `infra/media-worker.Dockerfile`

**Interfaces:**
- Produces: release-blocking CI and deployment checks for organization/MFA/media invariants.
- Consumes: all previous tasks.

- [ ] **Step 1: Add a migration rehearsal script and test fixtures**

Create three sanitized database fixtures: empty database, existing users/admin with cases/assets/invites/audit, and invalid existing database with no active admin. Rehearse backup → migrate → verify counts/ownership → enroll migrated user → restore backup. The invalid fixture must abort before destructive schema changes.

- [ ] **Step 2: Add environment readiness failures**

`verify:env` must check MFA keyring structure without printing keys, database/app clock difference under two seconds, media DB role denial of application tables, object-store bucket privacy, quarantine/derivative prefix permissions, media-worker runtime sharp/libvips version, and absence of a ready avatar pointing to a quarantine key.

- [ ] **Step 3: Update the threat model with explicit residual risks**

Document that TOTP is not phishing-resistant, a compromised server process can use decrypted TOTP secrets while running, endpoint malware can capture password/TOTP, recovery requires careful identity verification, and native image decoders can contain unknown vulnerabilities. Record containment, monitoring, key rotation, and a future WebAuthn/passkey track without claiming those risks are eliminated.

- [ ] **Step 4: Add CI dependency and decoder gates**

CI runs `bun audit`, asserts the lockfile resolves `sharp >= 0.35.3` and bundled libvips `>= 8.18.3`, runs sanitizer fixtures under memory/time limits, and fails on any critical/high advisory affecting reachable production dependencies unless a reviewed, expiring exception is committed with owner and date.

- [ ] **Step 5: Run the complete unit and integration suites**

Run: `bunx vitest --run --project node --project dom`

Run: `bunx vitest --run --project node-integration`

Expected: zero failures and zero unexpected warnings.

- [ ] **Step 6: Run static and build verification**

Run: `bun run lint`

Run: `bun run format:check`

Run: `bun run typecheck`

Run: `bun run build`

Expected: all commands exit 0.

- [ ] **Step 7: Run release security assertions against packaged services**

Build server, worker, media-worker, and desktop packages. Verify non-root users, read-only media filesystem, dropped capabilities, no media-worker access to general database/S3 prefixes, API refusal without MFA keys, private avatar responses, no raw avatar route, and session issuance only after MFA. Record commands and outputs in the release checklist, never in source comments.

- [ ] **Step 8: Perform a manual abuse-case walkthrough with synthetic accounts**

Use one admin, member, and viewer. Exercise invitation theft expiry, five wrong MFA codes, concurrent OTP replay, recovery re-enrollment, final-admin race, member organization mutation, SVG/GIF/polyglot/bomb avatar rejection, valid PNG/JPEG publication, raw-object denial, session revocation, and stale-MFA step-up. Remove synthetic users and objects afterward.

- [ ] **Step 9: Review audit and secret redaction**

Search captured test logs, audit rows, error responses, renderer storage, Electron session storage, object metadata, and crash output for sentinel password, invitation, challenge, TOTP secret, provisioning URI, OTP, recovery code, filesystem path, and object credential values. Any match blocks release.

- [ ] **Step 10: Commit documentation and release gates**

```bash
git add docs README.md scripts/verify-env.ts .github/workflows/ci.yml infra
git commit -m "docs: add organization security release gates"
```

## Implementation Review Checkpoints

After Tasks 1–2, review migration reversibility, organization scoping, and final-admin concurrency before touching authentication. After Tasks 3–7, perform an authentication-specific review focused on challenge binding, token secrecy, replay atomics, recovery state, and session issuance. After Tasks 8–9, perform a media-specific review focused on loader reachability, native dependency versions, resource containment, least privilege, and raw/derivative separation. After Tasks 10–12, run the complete verification gate from a fresh database and an upgraded fixture.

Do not combine these checkpoints into a final cosmetic review. A reviewer may reject a slice even when later UI appears functional.

## Requirement Coverage Matrix

| Requirement | Owning tasks | Release proof |
| --- | --- | --- |
| One organization and atomic first administrator | 1, 4 | fresh/backfill/invalid migration fixtures; bootstrap rollback tests |
| Membership-owned roles and final active administrator | 1, 2, 7 | deferred-trigger and two-connection race tests |
| All members read every case; write rules remain enforced | 2 | core permission and server authorization integration tests |
| Admin-only organization mutation and member-readable posture | 2, 7, 11 | API role matrix plus renderer visibility tests |
| Separate organization and personal routes; no organization landing page | 7, 11 | router tree and redirect tests |
| Invitation registration with mandatory MFA | 3, 5, 10 | zero-account-before-confirmation and signed-out flow tests |
| Password cannot issue a session without MFA | 6, 10 | session-row and Electron persistence negative tests |
| TOTP secrecy, throttling, replay, clock window, and step-up | 3, 6, 12 | RFC vectors, concurrent replay, throttle, redaction, readiness checks |
| Recovery cannot bypass MFA | 5, 6, 10 | recovery-re-enrollment-only API and UI tests |
| Organization and personal avatars | 7, 8, 11 | target authorization, state-machine, and UI tests |
| Image upload RCE/content/DoS defenses | 8, 9, 12 | allow-listed loader fixtures, patched runtime gate, least-privilege container checks |
| General evidence upload integrity and safe previews | 9 | signed checksum, streaming full-hash, and unsupported-preview tests |
| Existing installation migration | 1, 6, 12 | upgraded fixture, forced re-enrollment, rollback rehearsal |
| Immutable security audit and user notifications | 1, 5, 6, 7, 8, 9 | event assertions and secret-sentinel scan |
| Operational key, clock, storage, and worker readiness | 3, 9, 12 | `verify:env`, CI dependency gate, packaged-service assertions |
