# Vendor Submissions and Gmail Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end case-to-vendor workflow that creates reusable vendors and disclosure routes, prepares and validates manual or Gmail submissions, optionally seals them with OpenPGP, sends only after human review, follows only the Gmail threads CodeVault created, and surfaces response/follow-up work on the dashboard.

**Architecture:** A Vendor owns many Assets and one or more versioned Disclosure Routes. A case-level Submission snapshots one route, contains reviewed outbound messages and immutable package manifests, and owns a correspondence thread plus a human-controlled coordination lifecycle. Gmail is the first `MailProvider`; portal routes only generate copyable/downloadable packages. OpenPGP composition and optional signing happen in the trusted Electron main process, while Gmail OAuth tokens and background thread cursors are encrypted server-side so synchronization continues when the desktop is closed.

**Tech Stack:** Bun 1.3, Node 24, TypeScript 5.9, React 19, Electron, Fastify, TypeBox, Drizzle/PostgreSQL, pg-boss, S3-compatible storage, Gmail REST API/OAuth 2.0, Cloud Pub/Sub, OpenPGP.js, Nodemailer MailComposer, mailparser, Vitest, Playwright.

**Spec:** No separate spec by user request. The approved requirements and invariants are restated in this plan.

## Global Constraints

- The product is an invited, single-organization workspace. Existing case read/write access governs all vendor and submission actions in version one; any case writer may approve their own submission.
- A vendor is an internal directory record, never an external CodeVault account. A vendor owns many assets; an asset has at most one primary vendor in version one.
- A vendor may have multiple routes. Route types are `EMAIL` and `MANUAL`; Gmail is the only automated transport. Manual routes generate fields/files for copy and download and never call a portal.
- Seeded vendors and routes are editable starter data with provenance and a review date. They are not privileged or silently refreshed from the internet.
- AI drafts; humans own truth. AI may propose an initial email, follow-up, reply classification, or thread summary, but it cannot approve, seal, send, alter recipients, choose cryptographic keys, or change lifecycle state.
- Every send requires a native Electron confirmation after the exact recipients, unencrypted subject, body, attachments, hashes, size, route snapshot, and cryptographic mode are shown.
- Supported cryptographic modes are `PLAIN`, `ENCRYPTED`, and `SIGNED_AND_ENCRYPTED`. Encryption uses a verified vendor public-key version. Signing is optional and uses a researcher private key that never leaves the workstation.
- Public keys are append-only versions. Trust requires an explicit fingerprint verification record; expired, revoked, replaced, or unverified keys block encryption.
- OpenPGP email uses PGP/MIME according to RFC 3156 and OpenPGP according to RFC 9580. Subject and ordinary transport headers remain unencrypted and the UI must say so.
- Gmail authorization uses incremental OAuth authorization-code flow with PKCE and offline access. Tokens are encrypted at rest, never logged, revoked on disconnect, and access tokens remain memory-only.
- Gmail reply synchronization may request `gmail.readonly`, a Google restricted scope. CodeVault processes mailbox history metadata but fetches and persists a body only when its `threadId` belongs to a CodeVault submission. Unrelated message bodies, snippets, addresses, and subjects are never fetched or stored.
- Gmail push is an optimization, not the source of truth. Periodic History API reconciliation is mandatory because Google documents that notifications may be delayed or dropped.
- A response never silently changes the finding or submission lifecycle. Arrival is a fact; AI may propose a message classification; a user records acknowledgement, triage, remediation, or closure.
- Follow-ups are suggested, never sent automatically. Route cadence uses business days and can override the organization fallback of five business days for first acknowledgement.
- Outbound artifacts must be `VENDOR` or `PUBLIC`, stored, hash-verified, and within the lower of the route and Gmail limits. Gmail-blocked file types are rejected before sealing.
- Every approval, seal, send attempt, send result, inbound message, lifecycle change, snooze, Gmail connection change, and key verification is append-only audited without tokens, private keys, passphrases, raw bodies, or full snapshots.
- Existing public-export visibility rules, restricted-case SQL access, renderer sandboxing, and offline PDF rendering remain unchanged.

## Research-Derived Requirements

- Gmail sends RFC-compatible MIME as base64url in `messages.send`; replies remain in a thread only when `threadId`, matching subject, and valid `References`/`In-Reply-To` headers are supplied.
- Gmail mailbox watches use Cloud Pub/Sub, must be renewed at least every seven days (Google recommends daily), and feed `history.list`; reconciliation must handle an expired history cursor with a targeted tracked-thread resync.
- `gmail.send` is sensitive. `gmail.readonly` and `gmail.metadata` are restricted; server-side handling of restricted-scope data can require Google verification and a security assessment.
- Personal Gmail attachments are limited to 25 MB and Gmail blocks several executable/archive types. CodeVault must validate the final MIME size as well as the sum of source files because MIME and OpenPGP add overhead.
- Common actionable report fields are vulnerability type, affected product/version/environment, configuration, reliable reproduction steps, evidence or PoC, security impact, remediation/mitigation, researcher contact, and disclosure expectations.
- ISO/IEC 29147 covers vulnerability disclosure; ISO/IEC 30111 covers handling. FIRST recommends documented intake, secure communications, receipt acknowledgement, regular updates, remediation validation, and coordinated disclosure.
- Timeframes are vendor- and policy-specific: TP-Link currently states five business days for acknowledgement and updates at least every six weeks; Microsoft states one business day; CERT/CC uses a 45-day publication baseline; Project Zero and CERT-EU use 90-day baselines. CodeVault must store rules, not encode one universal calendar.

## Delivery Phases

1. **Directory foundation:** vendors, key versions, disclosure routes, asset association, seeds.
2. **Manual package MVP:** submission composer, deterministic validation, approval, immutable manifest, copy/download bundle.
3. **OpenPGP:** local signing-key vault, verified public keys, PGP/MIME sealing, cryptographic verification.
4. **Gmail outbound:** per-user OAuth, provider interface, native send confirmation, idempotent delivery receipts.
5. **Tracked correspondence:** Gmail watch/history sync, tracked-thread-only ingestion, safe inbound artifacts, replies.
6. **Lifecycle and AI:** response classification proposals, business-day due dates, dashboard actions, follow-up drafting.
7. **Production hardening:** OAuth verification runbook, seed provenance, recovery paths, threat-model update, end-to-end tests.

---

### Task 1: Add vendor, route, submission, message, and lifecycle vocabulary

**Files:**
- Create: `packages/core/src/vendors.ts`
- Create: `packages/core/src/submissions.ts`
- Create: `packages/core/src/business-days.ts`
- Create: `packages/core/src/vendors.test.ts`
- Create: `packages/core/src/submissions.test.ts`
- Modify: `packages/core/src/identifiers.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `VendorRouteType`, `EncryptionPolicy`, `SubmissionStatus`, `CoordinationState`, `MessageClassification`, `assertSubmissionTransition`, `computeNextAction`, and reference kinds `vendor`/`submission`.
- Consumes: existing `ContentVisibility`, disclosure event vocabulary, and identifier formatting.

- [ ] **Step 1: Write failing domain tests**

```ts
it("does not treat an inbound auto-reply as acknowledgement", () => {
  expect(
    computeNextAction({
      state: "AWAITING_ACKNOWLEDGEMENT",
      lastOutboundAt: "2026-08-17T09:00:00.000Z",
      lastInboundAt: "2026-08-17T09:01:00.000Z",
      lastInboundClassification: "AUTO_REPLY",
      acknowledgementBusinessDays: 5,
      now: "2026-08-18T09:00:00.000Z",
    }),
  ).toMatchObject({ kind: "WAITING_FOR_ACKNOWLEDGEMENT" });
});

it("allows self approval but never skips sealing", () => {
  expect(() => assertSubmissionTransition("DRAFT", "APPROVED")).toThrow();
  expect(() => assertSubmissionTransition("IN_REVIEW", "APPROVED")).not.toThrow();
  expect(() => assertSubmissionTransition("APPROVED", "SEALED")).not.toThrow();
});
```

- [ ] **Step 2: Run the tests and verify that the new modules are missing**

Run: `bunx vitest --run --project node packages/core/src/vendors.test.ts packages/core/src/submissions.test.ts`

Expected: FAIL because the modules and exports do not exist.

- [ ] **Step 3: Implement the closed vocabularies and transition functions**

```ts
export const VENDOR_ROUTE_TYPES = ["EMAIL", "MANUAL"] as const;
export const ENCRYPTION_POLICIES = ["FORBIDDEN", "OPTIONAL", "REQUIRED"] as const;
export const CRYPTO_MODES = ["PLAIN", "ENCRYPTED", "SIGNED_AND_ENCRYPTED"] as const;
export const SUBMISSION_STATUSES = [
  "DRAFT", "IN_REVIEW", "APPROVED", "SEALED", "SENDING",
  "SENT", "SEND_FAILED", "RECORDED_MANUALLY", "CANCELLED",
] as const;
export const COORDINATION_STATES = [
  "PREPARING", "AWAITING_ACKNOWLEDGEMENT", "ACKNOWLEDGED",
  "NEEDS_INFORMATION", "IN_TRIAGE", "IN_REMEDIATION",
  "FIX_AVAILABLE", "COORDINATING_DISCLOSURE", "RESOLVED", "CLOSED",
] as const;
export const MESSAGE_CLASSIFICATIONS = [
  "UNREVIEWED", "AUTO_REPLY", "ACKNOWLEDGEMENT", "REQUEST_FOR_INFORMATION",
  "STATUS_UPDATE", "FIX_AVAILABLE", "REJECTION", "OTHER",
] as const;
```

Add `vendor: "VND"` and `submission: "SUB"` to `REFERENCE_PREFIXES`; both use flat sequences.

- [ ] **Step 4: Implement UTC business-day arithmetic with weekend skipping**

The first implementation intentionally excludes configurable holidays; a route stores business-day counts, and holiday calendars remain a future organization-policy feature.

```ts
export function addBusinessDays(iso: string, count: number): string {
  const date = new Date(iso);
  for (let added = 0; added < count; ) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date.toISOString();
}
```

- [ ] **Step 5: Run core tests and commit**

Run: `bunx vitest --run --project node packages/core/src/vendors.test.ts packages/core/src/submissions.test.ts packages/core/src/identifiers.test.ts`

Expected: PASS.

```bash
git add packages/core
git commit -m "feat: define vendor submission lifecycle"
```

### Task 2: Define transport-neutral API contracts

**Files:**
- Create: `packages/contracts/src/vendors.ts`
- Create: `packages/contracts/src/submissions.ts`
- Create: `packages/contracts/src/mail.ts`
- Create: `packages/contracts/src/submissions.test.ts`
- Modify: `packages/contracts/src/assets.ts`
- Modify: `packages/contracts/src/ai.ts`
- Modify: `packages/contracts/src/dashboard.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: TypeBox schemas for vendor CRUD, route requirements, public keys, submission drafts/manifests/validation, Gmail connections, correspondence messages, and dashboard actions.
- Consumes: enums from Task 1 and existing `Artifact`, `ReportExport`, `ActorSummary`, `ContentVisibility`, and revision schemas.

- [ ] **Step 1: Write a failing contract test for route-specific requirements**

```ts
it("rejects an email route that requires encryption without a key", () => {
  const value = {
    vendorId: crypto.randomUUID(),
    name: "PSIRT email",
    type: "EMAIL",
    recipients: ["security@example.com"],
    encryptionPolicy: "REQUIRED",
    publicKeyId: null,
    acknowledgementBusinessDays: 5,
    updateCadenceDays: 42,
    requiredFields: ["affected_product", "reproduction", "impact"],
  };
  expect(Value.Check(CreateVendorRouteRequest, value)).toBe(false);
});
```

- [ ] **Step 2: Run the contract test to verify failure**

Run: `bunx vitest --run --project node packages/contracts/src/submissions.test.ts`

Expected: FAIL because the schemas are missing.

- [ ] **Step 3: Add explicit route and submission schemas**

Use a discriminated union, not open-ended executable JSON:

```ts
export const EmailRouteRequirements = Type.Object({
  type: Type.Literal("EMAIL"),
  to: Type.Array(Type.String({ format: "email" }), { minItems: 1, maxItems: 10 }),
  cc: Type.Array(Type.String({ format: "email" }), { maxItems: 10 }),
  subjectTemplate: Type.String({ maxLength: 300 }),
  encryptionPolicy: enumOf(ENCRYPTION_POLICIES),
  publicKeyId: Type.Union([Uuid, Type.Null()]),
  maximumAttachmentBytes: Type.Integer({ minimum: 0, maximum: 25 * 1024 * 1024 }),
  acknowledgementBusinessDays: Type.Integer({ minimum: 1, maximum: 90 }),
  updateCadenceDays: Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.Null()]),
  requiredFields: Type.Array(enumOf(SUBMISSION_FIELD_KEYS)),
});
```

Define manual routes with `destinationUrl`, ordered `fieldMappings`, accepted extensions, and file limits. Define `SubmissionValidationFinding` with `BLOCKING | WARNING | INFO`, stable code, field, and message.

- [ ] **Step 4: Extend AI and dashboard contracts**

Add action IDs `SUBMISSION_DRAFT_INITIAL`, `SUBMISSION_DRAFT_FOLLOW_UP`, `SUBMISSION_CLASSIFY_REPLY`, `SUBMISSION_SUMMARIZE_THREAD`, and `SUBMISSION_LEAK_REVIEW`; add target types `SUBMISSION` and `CORRESPONDENCE_MESSAGE`. Add attention kinds `SUBMISSION_NEEDS_REVIEW`, `VENDOR_REPLY_NEEDS_REVIEW`, `VENDOR_ACKNOWLEDGEMENT_OVERDUE`, `VENDOR_UPDATE_OVERDUE`, `GMAIL_RECONNECT_REQUIRED`, and `SUBMISSION_SEND_FAILED`.

- [ ] **Step 5: Run contract and type checks and commit**

Run: `bunx vitest --run --project node packages/contracts/src/submissions.test.ts && bun run --cwd packages/contracts typecheck`

Expected: PASS.

```bash
git add packages/contracts
git commit -m "feat: add vendor and submission contracts"
```

### Task 3: Add the relational model, migration, and safe legacy-vendor backfill

**Files:**
- Create: `packages/db/src/schema/vendors.ts`
- Create: `packages/db/src/schema/submissions.ts`
- Create: `packages/db/src/schema/mail.ts`
- Create: `packages/db/drizzle/0004_vendor_submissions_gmail.sql`
- Create: `packages/db/src/vendor-submissions.integration.test.ts`
- Modify: `packages/db/src/schema/assets.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/client.integration.test.ts`

**Interfaces:**
- Produces: tables `vendors`, `vendor_public_keys`, `vendor_routes`, `submissions`, `submission_revisions`, `submission_attachments`, `submission_approvals`, `submission_packages`, `submission_deliveries`, `submission_delivery_attempts`, `correspondence_messages`, `mailbox_connections`, and `mailbox_sync_events`.
- Consumes: UUIDv7 application IDs, existing artifacts/reports/cases/users, and Task 1 state types.

- [ ] **Step 1: Write failing integration tests for ownership and immutability**

```ts
it("allows one vendor to own many assets and preserves a route snapshot", async () => {
  const vendor = await createVendor(db, "TP-Link");
  const route = await createEmailRoute(db, vendor.id, "security@tp-link.com");
  const first = await createAsset(db, { name: "Archer", vendorId: vendor.id });
  const second = await createAsset(db, { name: "Tapo", vendorId: vendor.id });
  const submission = await createSubmission(db, { caseId, vendorId: vendor.id, routeId: route.id });
  await renameRoute(db, route.id, "New PSIRT route");
  expect(first.vendorId).toBe(second.vendorId);
  expect(submission.routeSnapshot.name).not.toBe("New PSIRT route");
});
```

- [ ] **Step 2: Run the integration test and verify missing schema failure**

Run: `bunx vitest --run --project node-integration packages/db/src/vendor-submissions.integration.test.ts`

Expected: FAIL because the tables are missing.

- [ ] **Step 3: Implement focused Drizzle schemas**

Store route requirements and snapshots as validated JSONB, never as executable templates. Store OAuth token ciphertext as `bytea` plus nonce, authentication tag, and key version; never store an access token. Store Gmail `historyId` as text because it is an opaque 64-bit value. Add unique indexes for vendor normalized name, `(vendor_id, fingerprint)`, `(provider, external_account_id)`, `(mailbox_connection_id, provider_message_id)`, and package SHA-256.

- [ ] **Step 4: Write the SQL migration with reversible data preservation**

The migration must:

1. Create vendor tables before adding `assets.vendor_id`.
2. Create one vendor for each distinct non-empty legacy `assets.vendor` value using deterministic `gen_random_uuid()` IDs within the migration.
3. Backfill `assets.vendor_id` by normalized exact name.
4. Retain `assets.vendor` as `legacy_vendor_name` for one release; application writes only `vendor_id`.
5. Add append-only UPDATE/DELETE rules to `submission_packages`, `submission_delivery_attempts`, and `mailbox_sync_events` following the audit-table pattern. `submission_deliveries` remains a mutable state row whose every transition is audited.
6. Add check constraints tying route type to its requirements shape, key verification timestamps to a verifier, and `SENT` deliveries to provider IDs/timestamps.

- [ ] **Step 5: Add seeded records through application startup, not immutable migration SQL**

Seed only stable identity and reviewed route data. Initial records are TP-Link and WordPress.org with `builtIn=true`, `sourceUrl`, `sourceReviewedAt`, and editable routes. Do not auto-link existing assets to WordPress.org or insert a Hummingbird vendor guess. Import the current TP-Link public key only after its fingerprint is independently verified during implementation.

- [ ] **Step 6: Run migration/schema tests and commit**

Run: `bun run db:migrate && bunx vitest --run --project node-integration packages/db/src/vendor-submissions.integration.test.ts packages/db/src/client.integration.test.ts`

Expected: PASS and a second migration run reports no pending migrations.

```bash
git add packages/db
git commit -m "feat: persist vendors submissions and mail threads"
```

### Task 4: Build vendor, route, public-key, and asset-association APIs

**Files:**
- Create: `apps/server/src/modules/vendors/routes.ts`
- Create: `apps/server/src/modules/vendors/service.ts`
- Create: `apps/server/src/modules/vendors/routes.integration.test.ts`
- Modify: `apps/server/src/modules/assets/routes.ts`
- Modify: `apps/server/src/startup/seed.ts`
- Modify: `apps/server/src/routes.ts`
- Modify: `apps/server/src/services/audit.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Produces: `/v1/vendors`, `/v1/vendors/:id`, `/v1/vendors/:id/routes`, `/v1/vendors/:id/public-keys`, `/v1/vendor-routes/:id`, and asset `vendorId` read/write support.
- Consumes: contracts from Task 2, schema from Task 3, `requireCaseWrite` for asset changes, authenticated-member guard for shared vendor-directory changes.

- [ ] **Step 1: Write failing API tests**

Cover creation, normalized-name uniqueness, route validation, append-only key replacement, fingerprint verification audit, asset linkage, pagination, and disabled/deleted routes remaining readable through submission snapshots.

```ts
const key = await app.inject({
  method: "POST",
  url: `/v1/vendors/${vendorId}/public-keys`,
  headers: auth(author),
  payload: { armoredKey, sourceUrl, expectedFingerprint },
});
expect(key.statusCode).toBe(200);
expect(key.json().fingerprint).toBe(expectedFingerprint);
expect(key.json().verifiedAt).toBeNull();
```

- [ ] **Step 2: Run tests and verify 404 failures**

Run: `bunx vitest --run --project node-integration apps/server/src/modules/vendors/routes.integration.test.ts`

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement vendor and route CRUD with optimistic concurrency**

All mutable resources carry `revision`. Deleting a vendor with linked assets or submissions archives it instead. Routes may be disabled, not hard-deleted. Parse public keys server-side with OpenPGP.js to derive fingerprint, identities, algorithm capabilities, creation, expiry, and revocation; reject caller-supplied derived values that do not match.

- [ ] **Step 4: Implement explicit key verification and replacement**

`POST /v1/vendors/:vendorId/public-keys/:keyId/verify` requires `expectedFingerprint`, `sourceUrl`, and `expectedRevision`. It records `verifiedBy`/`verifiedAt`. Replacing a key creates a new row and marks the old row superseded; existing package snapshots retain the old key fingerprint and bytes.

- [ ] **Step 5: Extend assets and seed startup**

Asset responses include `{ vendorId, vendor: VendorSummary | null, legacyVendorName }`. Create/update requests accept only `vendorId`. Seed upsert keys are stable slugs (`tp-link`, `wordpress-org`) and never overwrite user edits after `builtInModifiedAt` is set.

- [ ] **Step 6: Run authorization, API, and audit tests and commit**

Run: `bunx vitest --run --project node-integration apps/server/src/modules/vendors/routes.integration.test.ts apps/server/src/authorization.integration.test.ts`

Expected: PASS.

```bash
git add apps/server packages/db
git commit -m "feat: expose vendor directory APIs"
```

### Task 5: Add the vendor directory and asset picker to the desktop interface

**Files:**
- Create: `apps/desktop/src/renderer/src/routes/vendors.tsx`
- Create: `apps/desktop/src/renderer/src/features/vendors/vendor-dialog.tsx`
- Create: `apps/desktop/src/renderer/src/features/vendors/route-editor.tsx`
- Create: `apps/desktop/src/renderer/src/features/vendors/public-key-panel.tsx`
- Create: `apps/desktop/src/renderer/src/features/vendors/vendors.test.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/assets.tsx`
- Modify: `apps/desktop/src/renderer/src/router.tsx`
- Modify: `apps/desktop/src/renderer/src/components/app-sidebar.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/api.ts`

**Interfaces:**
- Produces: organization-wide Vendor screens and a searchable `vendorId` selector on asset create/edit.
- Consumes: Task 4 endpoints and existing semantic UI components.

- [ ] **Step 1: Write failing renderer tests for the directory and key trust UI**

```tsx
it("shows an unverified key as unusable for required encryption", async () => {
  render(<PublicKeyPanel vendorId={vendorId} />);
  expect(await screen.findByText("Not verified")).toBeVisible();
  expect(screen.getByRole("button", { name: "Use for encryption" })).toBeDisabled();
});

it("links an asset to a vendor ID instead of saving free text", async () => {
  await user.selectOptions(screen.getByLabelText("Vendor"), vendorId);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(api.patch).toHaveBeenCalledWith(expect.objectContaining({ vendorId }));
});
```

- [ ] **Step 2: Run the DOM tests and verify missing-component failure**

Run: `bunx vitest --run --project dom apps/desktop/src/renderer/src/features/vendors/vendors.test.tsx`

Expected: FAIL because the Vendor UI does not exist.

- [ ] **Step 3: Implement the directory list/detail flow**

The detail screen has Identity, Assets, Disclosure Routes, and Public Keys sections. Show source URL/review date for seeded data and a visible “starter data—verify before use” badge. Do not put organization-role controls in this release.

- [ ] **Step 4: Implement route editors and key verification**

The EMAIL editor exposes To/CC, subject pattern, required fields, response business days, update cadence, encryption policy, selected key, size/file rules, and source provenance. The MANUAL editor exposes destination URL, ordered fields, required attachments, and copy/download instructions. The key panel shows full fingerprint in grouped text and requires typing the last eight hexadecimal characters before Verify becomes enabled.

- [ ] **Step 5: Implement asset linkage and suggestions**

Asset create/edit uses a searchable vendor selector with “Create vendor” as an explicit action. Asset detail links to the vendor and shows its active routes; it does not choose a route on the asset because a product can use different disclosure routes over time.

- [ ] **Step 6: Run DOM/type checks and commit**

Run: `bunx vitest --run --project dom apps/desktop/src/renderer/src/features/vendors/vendors.test.tsx && bun run --cwd apps/desktop typecheck`

Expected: PASS.

```bash
git add apps/desktop
git commit -m "feat: add vendor directory interface"
```

### Task 6: Implement the submission aggregate and deterministic validator

**Files:**
- Create: `apps/server/src/modules/submissions/routes.ts`
- Create: `apps/server/src/modules/submissions/service.ts`
- Create: `apps/server/src/modules/submissions/validation.ts`
- Create: `apps/server/src/modules/submissions/validation.test.ts`
- Create: `apps/server/src/modules/submissions/routes.integration.test.ts`
- Modify: `apps/server/src/routes.ts`
- Modify: `apps/server/src/modules/cases/readiness.ts`
- Modify: `apps/server/src/services/audit.ts`

**Interfaces:**
- Produces: submission CRUD, revision history, attachment selection, lint/validation, approval, manual-delivery recording, and immutable package manifests.
- Consumes: cases/findings/reports/exports/artifacts, route snapshots, `canInclude`, and Task 1 transition functions.

- [ ] **Step 1: Write failing validator unit tests**

```ts
it("blocks an internal artifact from a vendor submission", () => {
  const result = validateSubmission(baseInput({
    attachments: [{ id: artifactId, visibility: "INTERNAL", status: "STORED", sizeBytes: 10, sha256 }],
  }));
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: "ATTACHMENT_VISIBILITY_VIOLATION",
    severity: "BLOCKING",
  }));
});

it("warns that a PGP subject remains visible", () => {
  const result = validateSubmission(baseInput({ cryptoMode: "ENCRYPTED" }));
  expect(result.findings).toContainEqual(expect.objectContaining({ code: "SUBJECT_NOT_ENCRYPTED" }));
});
```

- [ ] **Step 2: Run unit tests and verify failure**

Run: `bunx vitest --run --project node apps/server/src/modules/submissions/validation.test.ts`

Expected: FAIL because `validateSubmission` is missing.

- [ ] **Step 3: Implement pure validation before routes**

Validation returns stable findings for: missing route fields; invalid recipients; route/source staleness; missing approved vendor report or completed PDF; attachment visibility/status/hash; PoC audience approval; required/forbidden encryption; missing/unverified/expired/revoked key; required field content; unreviewed AI draft; Gmail blocked extension; route/Gmail/final-MIME size; disclosure/TLP conflicts; sensitive subject warning; changed source revision; and missing Gmail connection for EMAIL sends.

- [ ] **Step 4: Implement submission API state transitions**

Expose:

```text
POST   /v1/cases/:caseId/submissions
GET    /v1/cases/:caseId/submissions
GET    /v1/submissions/:id
PATCH  /v1/submissions/:id
POST   /v1/submissions/:id/attachments
GET    /v1/submissions/:id/validation
POST   /v1/submissions/:id/review
POST   /v1/submissions/:id/approve
POST   /v1/submissions/:id/seal-intent
POST   /v1/submissions/:id/manual-deliveries
```

Creation snapshots the entire validated route including recipients, form fields, cadence, source URL/review date, and selected key version. Editing an approved submission drops it to `IN_REVIEW` and invalidates any prior seal. Approval records the exact submission revision and may be self-approved.

- [ ] **Step 5: Implement package manifest creation**

The server returns a seal intent containing canonical UTF-8 subject/body/manual fields, ordered attachment descriptors with signed download URLs, every source ID/revision/SHA-256, crypto mode, public key bytes/fingerprint, and a one-time upload target. Canonical JSON is key-sorted and hashed. The intent expires after 15 minutes and cannot be reused.

- [ ] **Step 6: Implement manual delivery**

Manual routes can be marked delivered only from a sealed package. Record timestamp, destination URL, optional external reference, actor, and package digest; append `DETAILS_SENT` to the disclosure timeline. No external request is performed.

- [ ] **Step 7: Run unit/integration tests and commit**

Run: `bunx vitest --run --project node apps/server/src/modules/submissions/validation.test.ts && bunx vitest --run --project node-integration apps/server/src/modules/submissions/routes.integration.test.ts`

Expected: PASS.

```bash
git add apps/server
git commit -m "feat: add validated disclosure submissions"
```

### Task 7: Build the submission composer and manual package workflow

**Files:**
- Create: `apps/desktop/src/renderer/src/routes/submission-detail.tsx`
- Create: `apps/desktop/src/renderer/src/features/submissions/create-submission-dialog.tsx`
- Create: `apps/desktop/src/renderer/src/features/submissions/submission-composer.tsx`
- Create: `apps/desktop/src/renderer/src/features/submissions/submission-validator.tsx`
- Create: `apps/desktop/src/renderer/src/features/submissions/package-review.tsx`
- Create: `apps/desktop/src/renderer/src/features/submissions/manual-delivery-panel.tsx`
- Create: `apps/desktop/src/renderer/src/features/submissions/submission-composer.test.tsx`
- Create: `apps/desktop/src/main/submissions/manual-package.ts`
- Create: `apps/desktop/src/main/submissions/manual-package.test.ts`
- Modify: `apps/desktop/src/renderer/src/features/disclosure/disclosure-panel.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/case-detail.tsx`
- Modify: `apps/desktop/src/renderer/src/router.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/api.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/contracts.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces: a case-to-vendor wizard, draft editor, attachment/report selector, validation gate, exact-review screen, and manual copy/download/record flow.
- Consumes: Task 6 endpoints and existing report/evidence UI patterns.

- [ ] **Step 1: Write failing UI tests for the complete manual happy path**

```tsx
it("cannot record a manual submission until every blocking issue is fixed", async () => {
  render(<SubmissionDetailRoute submissionId={submissionId} />);
  expect(await screen.findByRole("button", { name: "Record as submitted" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Attach approved vendor PDF" }));
  await user.click(screen.getByRole("button", { name: "Approve exact content" }));
  expect(screen.getByRole("button", { name: "Record as submitted" })).toBeEnabled();
});
```

- [ ] **Step 2: Run DOM tests and verify failure**

Run: `bunx vitest --run --project dom apps/desktop/src/renderer/src/features/submissions/submission-composer.test.tsx`

Expected: FAIL because the submission route and components are missing.

- [ ] **Step 3: Implement route suggestion and creation**

From the Disclosure tab, “Prepare submission” lists vendors inferred from case assets, then their active routes. Cases with several asset vendors require an explicit choice. Allow selecting any directory vendor after a warning, supporting coordinators without pretending they own the asset.

- [ ] **Step 4: Implement the composer**

The email composer edits subject and Markdown-backed plain text; the manual composer renders route-defined ordered fields. Both select a completed vendor PDF, vendor-visible evidence, approved PoCs, and optional researcher public key. Every attachment row shows filename, visibility, size, digest prefix, source revision, and why it is eligible/ineligible.

- [ ] **Step 5: Implement review and manual bundle download**

Review shows the exact unencrypted content, immutable route snapshot, required fields, files, hashes, and warnings. Add the exact named IPC operation `submissions.downloadManualBundle(submissionId)`: main fetches the one-time seal intent, verifies each downloaded digest, creates the ZIP, uploads the sealed package record, and opens a native Save dialog. Manual downloads include `submission.txt`, route-field files, selected artifacts, `manifest.json`, and `SHA256SUMS`. The bundle does not claim it was delivered; the user separately records the external submission.

- [ ] **Step 6: Run DOM/type checks and commit**

Run: `bunx vitest --run --project dom apps/desktop/src/renderer/src/features/submissions/submission-composer.test.tsx && bun run --cwd apps/desktop typecheck`

Expected: PASS.

```bash
git add apps/desktop
git commit -m "feat: add manual vendor submission workflow"
```

### Task 8: Add AI drafting and review without granting delivery authority

**Files:**
- Modify: `packages/ai/src/actions.ts`
- Modify: `packages/ai/src/schemas.ts`
- Modify: `packages/ai/src/prompts/index.ts`
- Create: `packages/ai/src/submissions.test.ts`
- Modify: `apps/server/src/modules/ai/context-builder.ts`
- Modify: `apps/server/src/modules/ai/apply-proposal.ts`
- Modify: `apps/server/src/ai-security.integration.test.ts`
- Create: `apps/desktop/src/renderer/src/features/submissions/submission-ai-toolbar.tsx`
- Modify: `apps/desktop/src/renderer/src/features/submissions/submission-composer.tsx`

**Interfaces:**
- Produces: fixed AI actions for initial draft, follow-up draft, reply classification, thread summary, and leak review.
- Consumes: existing context manifest/filtering, proposal review, provider profiles, and submission/message revisions.

- [ ] **Step 1: Write failing registry and security tests**

```ts
it("submission drafting cannot change recipients or crypto", () => {
  const action = aiAction("SUBMISSION_DRAFT_INITIAL");
  expect(action.allowedPatchFields).toEqual(["subject", "bodyMarkdown"]);
  expect(action.allowedPatchFields).not.toContain("to");
  expect(action.allowedPatchFields).not.toContain("cryptoMode");
});

it("vendor email drafting never receives INTERNAL evidence", async () => {
  const preview = await prepareSubmissionRun(testInput);
  expect(preview.context.items.every((item) => item.visibility !== "INTERNAL")).toBe(true);
});
```

- [ ] **Step 2: Run AI tests and verify missing-action failure**

Run: `bunx vitest --run --project node packages/ai/src/submissions.test.ts && bunx vitest --run --project node-integration apps/server/src/ai-security.integration.test.ts`

Expected: FAIL because submission actions are absent.

- [ ] **Step 3: Add narrow structured outputs and prompts**

`SUBMISSION_DRAFT_INITIAL` returns `{ subject, bodyMarkdown, sourceRefs, rationale }`; follow-up returns `{ bodyMarkdown, questions, sourceRefs, rationale }`; classification returns ranked labels with evidence; summary returns dated facts and open questions; leak review returns findings only. Prompt text requires concise human-sounding writing and forbids inventing CVEs, deadlines, vendor acknowledgements, test results, or attachments.

- [ ] **Step 4: Build submission context at VENDOR audience**

Include route requirements/snapshot, public asset identity, vendor-visible findings, affected versions, approved scores, vendor-visible evidence metadata/previews, approved vendor-report sections, embargo/disclosure dates, and tracked correspondence. Treat incoming correspondence as untrusted prompt data. Exclude attachment bytes, private keys, OAuth data, INTERNAL records, and unrelated cases.

- [ ] **Step 5: Apply proposals with revision checks**

Draft acceptance may change subject/body only and resets submission review. Reply classification acceptance writes only `correspondence_messages.classification`; lifecycle changes remain a separate human endpoint. Every toolbar action first displays exact context and requires Accept/Edit/Reject.

- [ ] **Step 6: Run AI/security tests and commit**

Run: `bunx vitest --run --project node packages/ai/src/submissions.test.ts packages/ai/src/context.test.ts packages/ai/src/proposals.test.ts && bunx vitest --run --project node-integration apps/server/src/ai-security.integration.test.ts`

Expected: PASS.

```bash
git add packages/ai packages/contracts apps/server apps/desktop
git commit -m "feat: add reviewed AI submission drafting"
```

### Task 9: Implement local OpenPGP key custody and deterministic PGP/MIME sealing

**Files:**
- Create: `apps/desktop/src/main/crypto/signing-key-store.ts`
- Create: `apps/desktop/src/main/crypto/openpgp-message.ts`
- Create: `apps/desktop/src/main/crypto/openpgp-message.test.ts`
- Create: `apps/desktop/src/main/submissions/package-builder.ts`
- Create: `apps/desktop/src/main/submissions/package-builder.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/contracts.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/server/src/modules/submissions/routes.ts`
- Modify: `docs/architecture/threat-model.md`

**Interfaces:**
- Produces: named desktop operations `signingKeys.list/import/remove` and `submissions.seal`, plus `buildPgpMimeMessage` and sealed `.eml`/manual bundle uploads.
- Consumes: one-time seal intents from Task 6, presigned object downloads/uploads, Electron `safeStorage`, OpenPGP.js, and MailComposer.

- [ ] **Step 1: Add dependencies and write failing crypto vectors**

Add pinned `openpgp` and `nodemailer` versions plus type definitions. Test plain, encrypted, and signed-and-encrypted MIME using fixed test keys and a fixed clock. Verify decryptability, signature validity, CRLF canonicalization, attachment byte equality, and that the subject is outside the encrypted MIME body.

```ts
const sealed = await buildPgpMimeMessage(fixture);
const opened = await decryptTestMessage(sealed.raw, vendorPrivateKey, researcherPublicKey);
expect(opened.attachments[0]?.sha256).toBe(fixture.attachments[0]?.sha256);
expect(opened.signatureValid).toBe(true);
```

- [ ] **Step 2: Run tests and verify missing implementation failure**

Run: `bunx vitest --run --project node apps/desktop/src/main/crypto/openpgp-message.test.ts apps/desktop/src/main/submissions/package-builder.test.ts`

Expected: FAIL because the crypto modules are missing.

- [ ] **Step 3: Implement signing-key custody**

Import encrypted armored private keys only from a native file picker. Derive/store public metadata and encrypt private key bytes using `safeStorage`; never persist the passphrase. On Linux basic-text fallback, refuse persistence and offer session-only use with the same warning model as session tokens. Key enumeration exposes fingerprint/user IDs/expiry only. Removal securely deletes the encrypted local blob and metadata.

- [ ] **Step 4: Implement RFC 3156 sealing**

MailComposer builds a canonical inner `text/plain` plus attachments entity. `ENCRYPTED` encrypts it to all verified recipient keys; `SIGNED_AND_ENCRYPTED` signs locally then encrypts. Wrap it in RFC 3156 `multipart/encrypted` with `application/pgp-encrypted` and `application/octet-stream`. Generate one stable RFC `Message-ID` before hashing. Do not use inline PGP.

- [ ] **Step 5: Implement seal IPC with native review**

The renderer passes only a submission ID. Main fetches the server-owned seal intent, downloads bytes, verifies every digest and size, prompts for a signing passphrase if needed, builds the payload, re-opens it with test verification, shows a native summary dialog, uploads the result, and completes the seal with `{ intentId, sha256, sizeBytes, rfcMessageId }`.

- [ ] **Step 6: Update bridge security**

Add exact IPC channels rather than a generic filesystem/crypto primitive. Ensure `api.request` refuses high-impact `/send` endpoints so only the named native-confirmation operation can initiate a send. Extend renderer-compromise tests accordingly.

- [ ] **Step 7: Run crypto, IPC, and security tests and commit**

Run: `bunx vitest --run --project node apps/desktop/src/main/crypto/openpgp-message.test.ts apps/desktop/src/main/submissions/package-builder.test.ts apps/desktop/src/main/security.test.ts && bun run --cwd apps/desktop typecheck`

Expected: PASS.

```bash
git add apps/desktop apps/server docs/architecture/threat-model.md
git commit -m "feat: seal submissions with local OpenPGP"
```

### Task 10: Add encrypted per-user Gmail OAuth connections behind a provider interface

**Files:**
- Create: `apps/server/src/modules/mail/provider.ts`
- Create: `apps/server/src/modules/mail/provider-registry.ts`
- Create: `apps/server/src/modules/mail/gmail-provider.ts`
- Create: `apps/server/src/modules/mail/gmail-oauth.ts`
- Create: `apps/server/src/modules/mail/token-crypto.ts`
- Create: `apps/server/src/modules/mail/token-crypto.test.ts`
- Create: `apps/server/src/modules/mail/routes.ts`
- Create: `apps/server/src/modules/mail/routes.integration.test.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/routes.ts`
- Modify: `apps/server/src/plugins/types.ts`
- Modify: `apps/server/package.json`
- Modify: `.env.example`
- Modify: `scripts/verify-env.ts`
- Modify: `apps/desktop/src/renderer/src/routes/misc.tsx`

**Interfaces:**
- Produces: transport-neutral `MailProvider`, Gmail adapter, OAuth connect/callback/status/disconnect endpoints, encrypted refresh-token storage, and Account Settings UI.
- Consumes: `mailbox_connections` from Task 3 and Google OAuth/Gmail API libraries.

- [ ] **Step 1: Write failing token-envelope and OAuth-state tests**

```ts
it("detects token ciphertext tampering", () => {
  const envelope = encryptRefreshToken("refresh-token", keyring);
  envelope.ciphertext[0] ^= 1;
  expect(() => decryptRefreshToken(envelope, keyring)).toThrow("authentication");
});

it("rejects a reused OAuth state", async () => {
  const state = await startGmailOAuth(userId);
  await completeGmailOAuth(state, authorizationCode);
  await expect(completeGmailOAuth(state, authorizationCode)).rejects.toThrow();
});
```

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `bunx vitest --run --project node apps/server/src/modules/mail/token-crypto.test.ts && bunx vitest --run --project node-integration apps/server/src/modules/mail/routes.integration.test.ts`

Expected: FAIL because mail modules are absent.

- [ ] **Step 3: Define the provider boundary before Gmail code**

```ts
export interface MailProvider {
  readonly id: "gmail" | "outlook" | "smtp";
  send(connection: MailConnectionSecret, input: ProviderSendInput): Promise<ProviderSendResult>;
  getHistory(connection: MailConnectionSecret, cursor: string): Promise<ProviderHistoryPage>;
  getMessageMetadata(connection: MailConnectionSecret, id: string): Promise<ProviderMessageMetadata>;
  getMessageRaw(connection: MailConnectionSecret, id: string): Promise<Uint8Array>;
  startWatch(connection: MailConnectionSecret): Promise<ProviderWatch>;
  stopWatch(connection: MailConnectionSecret): Promise<void>;
  revoke(connection: MailConnectionSecret): Promise<void>;
}
```

Do not expose Google SDK objects above the adapter. Outlook/SMTP are reserved enum values only and have no UI or configuration in this plan. Export only the provider interfaces and Gmail factory through explicit `@codevault/server/mail/*` package exports for the worker.

- [ ] **Step 4: Implement OAuth authorization-code flow**

Use system-browser authorization, PKCE, single-use encrypted state, exact redirect URI, offline access, and incremental scopes. Request identity plus `gmail.send` when connecting to send; explain and request `gmail.readonly` before enabling reply tracking. Verify the returned mailbox identity and never permit a caller-supplied From address outside Gmail `sendAs` aliases.

- [ ] **Step 5: Implement AES-256-GCM envelope encryption**

Configuration includes `MAIL_TOKEN_KEYRING` as versioned base64 keys and `MAIL_ACTIVE_TOKEN_KEY_VERSION`. Bind ciphertext AAD to provider, connection ID, and user ID. Support decrypting old versions and a rewrap command; reject startup when Gmail is enabled without a valid active key.

- [ ] **Step 6: Implement settings UI and disconnect**

Show connected address, granted capabilities (`Send`, `Track replies`), last successful sync, watch expiry, and errors. Disconnect first calls Google revoke, then irreversibly deletes token ciphertext and stops the watch; historical submission messages remain.

- [ ] **Step 7: Run OAuth/config tests and commit**

Run: `bunx vitest --run --project node apps/server/src/modules/mail/token-crypto.test.ts && bunx vitest --run --project node-integration apps/server/src/modules/mail/routes.integration.test.ts && bun run verify:env`

Expected: PASS with Gmail disabled by default; Gmail-enabled test configuration validates all secrets.

```bash
git add apps/server apps/desktop .env.example scripts/verify-env.ts
git commit -m "feat: connect Gmail mailboxes securely"
```

### Task 11: Send sealed Gmail messages idempotently with native confirmation

**Files:**
- Create: `apps/worker/src/jobs/gmail-send.ts`
- Create: `apps/worker/src/jobs/gmail-send.test.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/server/src/services/jobs.ts`
- Modify: `apps/server/src/modules/submissions/routes.ts`
- Modify: `apps/server/src/modules/mail/gmail-provider.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/contracts.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/features/submissions/package-review.tsx`

**Interfaces:**
- Produces: `gmail-send` job, named desktop `submissions.send(submissionId)` operation, delivery reconciliation, Gmail IDs, and disclosure timeline event.
- Consumes: sealed `.eml` artifact, Gmail connection, stable RFC `Message-ID`, provider interface, and pg-boss.

- [ ] **Step 1: Write failing idempotency tests around an ambiguous send**

```ts
it("reconciles a timed-out send by stable RFC Message-ID before retrying", async () => {
  gmail.send.mockRejectedValueOnce(new TimeoutError());
  gmail.findByRfcMessageId.mockResolvedValueOnce({ id: "gmail-message", threadId: "gmail-thread" });
  await sendDelivery(context, deliveryId);
  expect(gmail.send).toHaveBeenCalledTimes(1);
  expect(await deliveryStatus(deliveryId)).toMatchObject({ status: "SENT", providerThreadId: "gmail-thread" });
});
```

- [ ] **Step 2: Run worker tests and verify failure**

Run: `bunx vitest --run --project node apps/worker/src/jobs/gmail-send.test.ts`

Expected: FAIL because the send job is missing.

- [ ] **Step 3: Implement native confirmation and queueing**

Main fetches the sealed package summary and displays From, To, CC, subject, body digest, attachment list/digests, crypto mode/fingerprint, and the explicit warning that send cannot be undone. Only native “Send now” calls the protected send endpoint. The server atomically creates one delivery row and one pg-boss job; repeated clicks return the same in-flight delivery.

- [ ] **Step 4: Implement send/reconcile state machine**

Use `QUEUED → SENDING → SENT | FAILED | DELIVERY_UNKNOWN`. Before any retry, query Gmail by stable RFC `Message-ID`; if found, record the Gmail message/thread IDs without resending. On deterministic Gmail rejection, store a redacted category/message. On timeout where reconciliation cannot decide, set `DELIVERY_UNKNOWN` and require a human retry decision.

- [ ] **Step 5: Record immutable evidence of delivery**

On success record sent timestamp, Gmail message/thread IDs, response size, package SHA-256, sender mailbox, recipients, and route snapshot ID. Add `VENDOR_CONTACTED` or `DETAILS_SENT` timeline event and transition submission coordination to `AWAITING_ACKNOWLEDGEMENT`. Never store an OAuth token or full raw MIME in audit JSON.

- [ ] **Step 6: Run worker/integration tests and commit**

Run: `bunx vitest --run --project node apps/worker/src/jobs/gmail-send.test.ts && bunx vitest --run --project node-integration apps/server/src/modules/submissions/routes.integration.test.ts`

Expected: PASS including duplicate-click and ambiguous-timeout cases.

```bash
git add apps/worker apps/server apps/desktop
git commit -m "feat: send sealed Gmail submissions"
```

### Task 12: Synchronize only CodeVault-created Gmail threads

**Files:**
- Create: `apps/server/src/modules/mail/gmail-notifications.ts`
- Create: `apps/server/src/modules/mail/gmail-notifications.test.ts`
- Create: `apps/worker/src/jobs/gmail-sync.ts`
- Create: `apps/worker/src/jobs/gmail-sync.test.ts`
- Create: `apps/worker/src/jobs/gmail-watch-renewal.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/server/src/services/jobs.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/modules/mail/gmail-provider.ts`
- Modify: `apps/server/src/modules/mail/routes.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: authenticated Pub/Sub receiver, daily watch renewal, periodic History API reconciliation, tracked-thread filter, cursor recovery, and sync health.
- Consumes: Gmail `watch`, `history.list`, metadata/raw message calls, pg-boss schedules, and known provider thread IDs from Task 11.

- [ ] **Step 1: Write the privacy-boundary test before any sync implementation**

```ts
it("does not fetch an unrelated Gmail message body", async () => {
  gmail.history.mockResolvedValue([{ messageId: "unrelated", threadId: "other-thread" }]);
  await syncMailbox(context, connectionId);
  expect(gmail.getMessageRaw).not.toHaveBeenCalled();
  expect(await storedMessageCount()).toBe(0);
});

it("fetches a message only after its thread ID matches", async () => {
  gmail.history.mockResolvedValue([{ messageId: "reply", threadId: trackedThreadId }]);
  await syncMailbox(context, connectionId);
  expect(gmail.getMessageRaw).toHaveBeenCalledWith(expect.anything(), "reply");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `bunx vitest --run --project node apps/worker/src/jobs/gmail-sync.test.ts apps/server/src/modules/mail/gmail-notifications.test.ts`

Expected: FAIL because sync modules are absent.

- [ ] **Step 3: Implement and authenticate Pub/Sub notifications**

Add a narrowly public endpoint that verifies Google-signed OIDC JWT issuer, audience, configured Pub/Sub service-account email, and body schema before enqueueing a connection sync. The endpoint stores only notification ID, email-address hash, history ID, and outcome. Return quickly and make duplicates harmless.

- [ ] **Step 4: Implement tracked-thread-first history processing**

For each history event, inspect only provider message ID/thread ID/labels. Compare thread ID against active submissions for that mailbox. Fetch raw content only on a match. Deduplicate with the unique provider-message index. Advance the cursor only after all matched messages are durably stored; never persist unrelated event content.

- [ ] **Step 5: Implement watch renewal and reconciliation**

Schedule watch renewal daily and history reconciliation every ten minutes. If Pub/Sub is not configured, reconciliation alone keeps the feature functional. When Gmail returns 404 for an expired cursor, call `threads.get` only for known tracked thread IDs, ingest unseen IDs, then reset the cursor from the mailbox profile; never perform a full mailbox import.

- [ ] **Step 6: Expose sync health**

Connection status becomes `ACTIVE`, `REAUTH_REQUIRED`, `WATCH_EXPIRED`, or `ERROR`. A failed sync produces a dashboard attention item without exposing provider response bodies.

- [ ] **Step 7: Run sync/privacy tests and commit**

Run: `bunx vitest --run --project node apps/worker/src/jobs/gmail-sync.test.ts apps/server/src/modules/mail/gmail-notifications.test.ts && bunx vitest --run --project node-integration apps/server/src/modules/mail/routes.integration.test.ts`

Expected: PASS, especially the “unrelated body never fetched” assertion.

```bash
git add apps/worker apps/server .env.example
git commit -m "feat: track CodeVault Gmail threads"
```

### Task 13: Ingest replies safely and support same-thread responses

**Files:**
- Create: `apps/worker/src/jobs/inbound-correspondence.ts`
- Create: `apps/worker/src/jobs/inbound-correspondence.test.ts`
- Create: `apps/server/src/modules/submissions/correspondence.ts`
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/jobs/gmail-sync.ts`
- Modify: `apps/server/src/modules/submissions/routes.ts`
- Modify: `apps/server/src/modules/evidence/queries.ts`
- Modify: `apps/desktop/src/main/crypto/openpgp-message.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/src/renderer/src/features/submissions/correspondence-thread.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/submission-detail.tsx`

**Interfaces:**
- Produces: safe inbound-message parsing, attachment artifacts, encrypted-reply handling, correspondence UI, and outbound replies with Gmail threading headers.
- Consumes: tracked raw messages from Task 12, mailparser, artifact storage/preview, local private keys, and submission composer/sealer.

- [ ] **Step 1: Write failing hostile-message tests**

Fixtures cover HTML scripts, remote images, oversized nesting, malformed MIME, duplicate Message-ID, filename traversal, encrypted PGP/MIME, and attachments. Assert HTML is not rendered, remote URLs are not fetched, filenames are data only, and ciphertext is never treated as plaintext.

- [ ] **Step 2: Run tests and verify failure**

Run: `bunx vitest --run --project node apps/worker/src/jobs/inbound-correspondence.test.ts`

Expected: FAIL because inbound parsing is missing.

- [ ] **Step 3: Parse and store tracked messages safely**

Store immutable envelope metadata, normalized plain-text body, selected safe headers, received time, provider IDs, classification `UNREVIEWED`, and raw `.eml` as a `VENDOR` artifact. Drop active HTML; convert simple HTML to text only when no text part exists. Store each attachment as an opaque-key `VENDOR` artifact, run the existing preview pipeline, and never auto-open it.

- [ ] **Step 4: Handle encrypted replies locally**

Server records that the body is encrypted and stores ciphertext/raw MIME only. Desktop “Decrypt locally” uses a named IPC operation and local key; decrypted content is shown ephemerally. “Save reviewed plaintext to case” is a separate explicit action that writes a human-reviewed correspondence revision. Private keys and passphrases never cross IPC into the renderer or server.

- [ ] **Step 5: Build the correspondence thread UI**

Show only messages belonging to this submission, direction, sender/recipients, timestamp, classification, crypto status, safe attachments, and sync status. It is not a mailbox view and has no search/list endpoint for unrelated Gmail content.

- [ ] **Step 6: Implement replies in the same Gmail thread**

Reply drafts reuse the submission route and package flow. Sealing supplies Gmail `threadId`, matching subject, and RFC-compliant `In-Reply-To`/`References` from the latest message. Each reply is separately reviewed, approved, sealed, natively confirmed, sent, and audited.

- [ ] **Step 7: Run inbound, crypto, and UI tests and commit**

Run: `bunx vitest --run --project node apps/worker/src/jobs/inbound-correspondence.test.ts apps/desktop/src/main/crypto/openpgp-message.test.ts && bunx vitest --run --project dom apps/desktop/src/renderer/src/features/submissions/submission-composer.test.ts`

Expected: PASS.

```bash
git add apps/worker apps/server apps/desktop
git commit -m "feat: add safe vendor correspondence threads"
```

### Task 14: Add lifecycle controls, due-date calculation, dashboard reminders, and follow-ups

**Files:**
- Create: `apps/server/src/modules/submissions/lifecycle.ts`
- Create: `apps/server/src/modules/submissions/lifecycle.test.ts`
- Create: `apps/server/src/modules/dashboard/routes.integration.test.ts`
- Modify: `apps/server/src/modules/submissions/routes.ts`
- Modify: `apps/server/src/modules/dashboard/routes.ts`
- Modify: `packages/contracts/src/dashboard.ts`
- Modify: `apps/desktop/src/renderer/src/routes/dashboard.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/misc.tsx`
- Modify: `apps/desktop/src/renderer/src/features/submissions/correspondence-thread.tsx`
- Modify: `apps/desktop/src/renderer/src/features/submissions/submission-ai-toolbar.tsx`

**Interfaces:**
- Produces: human lifecycle transitions, calculated/snoozable next actions, response-review tasks, dashboard deep links, and AI-assisted follow-up drafts.
- Consumes: Task 1 business-day logic, route snapshot cadence, message facts/classifications, embargo dates, and existing dashboard attention model.

- [ ] **Step 1: Write failing lifecycle and dashboard tests**

```ts
it("raises an overdue acknowledgement after five business days without a human reply", () => {
  const action = computeNextAction({
    sentAt: "2026-08-17T10:00:00.000Z",
    inboundMessages: [],
    acknowledgementBusinessDays: 5,
    state: "AWAITING_ACKNOWLEDGEMENT",
  });
  expect(action.kind).toBe("VENDOR_ACKNOWLEDGEMENT_OVERDUE");
  expect(action.dueAt).toBe("2026-08-24T10:00:00.000Z");
});

it("prioritizes an unreviewed reply over a cadence reminder", () => {
  expect(computeNextAction(withUnreviewedReply).kind).toBe("VENDOR_REPLY_NEEDS_REVIEW");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `bunx vitest --run --project node apps/server/src/modules/submissions/lifecycle.test.ts`

Expected: FAIL because lifecycle service is absent.

- [ ] **Step 3: Implement lifecycle actions and derivation**

Users may set state, planned next contact, agreed disclosure date, vendor reference, notes, and snooze reason. Facts such as sent/received timestamps are immutable. State changes require expected revision and are audited. The next-action priority is: send failure/unknown; reconnect required; unreviewed reply; missing acknowledgement; requested information awaiting our reply; update cadence overdue; disclosure date approaching.

- [ ] **Step 4: Extend dashboard queries and deep links**

Dashboard cards say what happened, why it is due, and the safe action: “Review reply,” “Draft follow-up,” “Reconnect Gmail,” or “Resolve send status.” No reminder action sends automatically. Links open `/submissions/:id` with the relevant thread/message selected.

- [ ] **Step 5: Implement AI-assisted follow-up and classification review**

“Draft follow-up” prepares `SUBMISSION_DRAFT_FOLLOW_UP` from reviewed thread content and route expectations. “Classify reply” proposes a label with cited message excerpts. Accepting a classification may recompute the next-action suggestion but never changes lifecycle state without a separate user click.

- [ ] **Step 6: Add vendor-performance facts without premature analytics**

Record acknowledgement latency and update intervals as queryable timestamps. Do not add rankings, scorecards, or organization policy editors in this release; existing metrics can consume these facts later.

- [ ] **Step 7: Run lifecycle/dashboard/UI tests and commit**

Run: `bunx vitest --run --project node apps/server/src/modules/submissions/lifecycle.test.ts && bunx vitest --run --project node-integration apps/server/src/modules/dashboard/routes.integration.test.ts && bunx vitest --run --project dom apps/desktop/src/renderer/src/features/submissions/submission-composer.test.ts`

Expected: PASS.

```bash
git add apps/server apps/desktop packages/contracts
git commit -m "feat: add disclosure response lifecycle"
```

### Task 15: Production hardening, documentation, and end-to-end verification

**Files:**
- Create: `docs/operations/gmail-integration.md`
- Create: `docs/operations/vendor-seed-maintenance.md`
- Create: `tests/e2e/vendor-submission.spec.ts`
- Create: `tests/e2e/gmail-thread-sync.spec.ts`
- Create: `tests/e2e/fixtures/fake-gmail.ts`
- Modify: `README.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/ai-security.md`
- Modify: `docs/architecture/report-model.md`
- Modify: `docs/architecture/threat-model.md`
- Modify: `scripts/seed-dev.ts`
- Modify: `scripts/verify-env.ts`
- Modify: `infra/docker-compose.yml`
- Modify: `playwright.config.ts`

**Interfaces:**
- Produces: deployment/runbook documentation, seed review process, recovery guidance, realistic fixtures, and release-grade acceptance tests.
- Consumes: every prior task.

- [ ] **Step 1: Add end-to-end fixtures and failing tests**

The Gmail E2E uses a fake provider server with deterministic OAuth, send, history, watch, timeout, and restricted-thread fixtures. The vendor E2E covers TP-Link-style required PGP email and WordPress-style manual fields without contacting either organization.

```ts
test("case to encrypted Gmail send to tracked reply", async ({ page }) => {
  await createCaseWithVendorAsset(page);
  await prepareApproveSealAndSend(page);
  await fakeGmail.deliverReply({ threadId: trackedThreadId, text: "Received; case TP-123" });
  await expect(page.getByText("Reply needs review")).toBeVisible();
  await expect(page.getByText("unrelated mailbox message")).toHaveCount(0);
});
```

- [ ] **Step 2: Run E2E tests and verify that missing setup fails clearly**

Run: `bun run e2e -- tests/e2e/vendor-submission.spec.ts tests/e2e/gmail-thread-sync.spec.ts`

Expected: FAIL until fixtures/runbooks are complete, without sending real email.

- [ ] **Step 3: Implement the fake Gmail server and Playwright wiring**

The fixture must implement OAuth authorize/token/revoke, `send`, `messages.list` by RFC Message-ID, `history.list`, `messages.get`, `threads.get`, and `watch`, with controls for timeouts, 404 history expiry, unrelated messages, push duplicates, and token revocation. Point Gmail base URLs to it only under E2E configuration; production configuration must reject non-HTTPS Google endpoints.

- [ ] **Step 4: Document Gmail deployment and compliance gates**

Cover Google Cloud project ownership, redirect URIs, consent screen, internal-vs-external app mode, sensitive/restricted scopes, OAuth verification/security assessment, Pub/Sub OIDC, token-key rotation, revocation, watch renewal, polling fallback, quotas, sender aliases, production TLS, and incident response for a token leak.

- [ ] **Step 5: Document vendor-seed provenance**

Every seed has an official source, retrieval/review date, reviewer, expected recipient, cadence, template digest, and PGP fingerprint. Release checks fail when a seed review is older than 180 days, but runtime never auto-updates it. Document that Hummingbird is not automatically assigned to WordPress.org; users create/link the actual maintainer vendor and choose the appropriate manual route.

- [ ] **Step 6: Update the threat model and accepted risks**

Add boundaries for OAuth token storage, Gmail restricted-scope capability versus application-level minimization, external send confirmation, send ambiguity/idempotency, PGP subject leakage, local private-key custody, hostile inbound MIME, Pub/Sub authentication, and the fact that a compromised OS remains out of scope.

- [ ] **Step 7: Run the complete verification matrix**

Run:

```bash
bun run lint
bun run format:check
bun run typecheck
bunx vitest --run --project node --project dom
bunx vitest --run --project node-integration
bun run build
bun run e2e -- tests/e2e/vendor-submission.spec.ts tests/e2e/gmail-thread-sync.spec.ts
```

Expected: every command exits 0. Integration tests use PostgreSQL/S3 fixtures; email tests use the fake provider only.

- [ ] **Step 8: Perform manual security acceptance**

Verify: unrelated Gmail body is not fetched; revoked token stops sync; key change invalidates an unsealed draft; approved edits invalidate approval; INTERNAL artifact cannot leave; native confirmation is unavoidable through generic IPC; duplicate send does not duplicate mail; an ambiguous send does not auto-retry; PGP/MIME decrypts in GnuPG and Thunderbird; subject remains visibly marked unencrypted; malicious inbound HTML cannot execute or fetch; and dashboard follow-up never auto-sends.

- [ ] **Step 9: Commit documentation and release verification**

```bash
git add README.md docs scripts infra tests
git commit -m "docs: complete vendor delivery operations"
```

## Deferred Work

- Outlook/Microsoft Graph and SMTP providers; the `MailProvider` interface reserves them but no implementation or UI is included.
- Direct HackerOne, WordPress, vendor-portal, or generic browser automation.
- Organization-defined roles, two-person approval, mandatory separation of duties, and custom holiday calendars.
- Automatic internet refresh of vendor contacts or keys.
- Automatic lifecycle changes or automatic follow-up sends.
- Organization-wide mailbox delegation, shared mailboxes, inbound email search, or a general email client.
- S/MIME, Gmail client-side encryption, Autocrypt negotiation, or WKD key discovery.
- Vendor scorecards and response-performance dashboards.

## Acceptance Checklist

- A user can create/edit a Vendor, link multiple Assets, add multiple EMAIL/MANUAL routes, and version/verify a public key.
- A case suggests vendors from its assets but supports explicit coordinator/other-vendor selection.
- Manual submissions can be drafted by AI, edited, validated, self-approved, sealed, downloaded/copied, and recorded without portal automation.
- Gmail can be connected by one user, a reviewed package can be sent from that mailbox, and the send has an immutable package/receipt.
- Plain, encrypted, and signed-and-encrypted packages work; private signing material remains local.
- CodeVault shows only tracked submission correspondence and proves by test that unrelated message bodies are never fetched or stored.
- Replies appear in the submission thread; hostile content is inert; encrypted replies require local explicit decryption.
- Dashboard reminders use route-specific business-day/update cadence, deep-link to the thread, and create drafts rather than sending.
- AI output is always a proposal and cannot change recipients, keys, attachments, approval, delivery, or lifecycle.
- Disconnect/revocation, watch expiry, history-cursor expiry, Gmail timeout, duplicated jobs, and ambiguous delivery all have safe recovery paths.

## Primary Research Sources

- Gmail send: https://developers.google.com/workspace/gmail/api/guides/sending
- Gmail threads: https://developers.google.com/workspace/gmail/api/guides/threads
- Gmail push/history: https://developers.google.com/workspace/gmail/api/guides/push
- Gmail OAuth scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google OAuth token practices: https://developers.google.com/identity/protocols/oauth2/resources/best-practices
- Gmail attachment limits: https://support.google.com/mail/answer/6584
- Gmail blocked files: https://support.google.com/mail/answer/6590
- OpenPGP: https://www.rfc-editor.org/rfc/rfc9580.html
- PGP/MIME: https://www.rfc-editor.org/rfc/rfc3156.html
- ISO/IEC 29147: https://www.iso.org/standard/72311.html
- FIRST PSIRT framework: https://www.first.org/standards/frameworks/psirts/psirt_services_framework_v1-1
- CERT/CC disclosure policy: https://certcc.github.io/certcc_disclosure_policy/
- Project Zero disclosure FAQ: https://projectzero.google/vulnerability-disclosure-faq.html
- TP-Link reporting requirements: https://www.tp-link.com/uk/press/security-advisory/
- Microsoft reporting guidance: https://www.microsoft.com/en-us/msrc/faqs-report-an-issue
- Apple report guidance: https://security.apple.com/bounty/guidelines/
