# Codex CLI and Intake Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex CLI as an independently configured local AI provider and deliver Phase 2's case-scoped, human-reviewed finding intake queue.

**Architecture:** A shared provider catalog defines provider-specific models and effort support, while fixed desktop adapters translate a server-resolved profile into Claude or Codex CLI arguments. Intake is a separate non-canonical aggregate: manual or future AI sources create pending draft items, and only a case writer's transactional accept or merge operation may affect canonical findings.

**Tech Stack:** TypeScript 5.9, TypeBox, Fastify, Drizzle/PostgreSQL, Electron, React 19, TanStack Query, Vitest.

## Global Constraints

- AI drafts; humans own truth.
- Provider configuration, model allow-lists and defaults are independent.
- The renderer never supplies prompts, executable arguments or working directories.
- Intake items are non-canonical until explicitly accepted or merged by a case writer.
- Accepted findings begin in the database defaults: draft validation, private disclosure, unchecked prior art and internal visibility.
- Every mutable intake decision is audited and terminal decisions are idempotency-protected.
- New behavior is implemented test-first and existing unrelated worktree changes are preserved.

---

### Task 1: Provider-scoped AI configuration

**Files:**
- Modify: `packages/contracts/src/ai.ts`
- Create: `packages/ai/src/providers.ts`
- Modify: `packages/ai/src/profiles.ts`
- Test: `packages/ai/src/providers.test.ts`
- Test: `packages/ai/src/profiles.test.ts`
- Modify: `packages/db/src/schema/ai.ts`

**Interfaces:**
- Produces: `AI_PROVIDER_DEFINITIONS`, `AiProviderId`, provider-specific model validation, and `resolveRunProfile(providerId, action, policy, override)`.
- Consumes: existing action registry and provider policy rows.

- [ ] Write failing tests proving a Claude model is rejected for Codex, a Codex model is rejected for Claude, and allowed effort levels are provider-specific.
- [ ] Run the focused tests and confirm failures are caused by the global model enum.
- [ ] Add the provider catalog and replace global model typing with bounded provider/model strings validated against the catalog.
- [ ] Change profile resolution and policy contracts to require the selected provider.
- [ ] Preserve the existing per-provider policy rows; create no implicit Codex policy or approval.
- [ ] Run focused contracts, AI and migration tests.

### Task 2: Codex CLI adapter

**Files:**
- Create: `apps/desktop/src/main/agents/codex-cli.ts`
- Create: `apps/desktop/src/main/agents/codex-cli.test.ts`
- Modify: `apps/desktop/src/main/agents/registry.ts`
- Modify: `apps/desktop/src/main/agents/types.ts`
- Modify: `apps/desktop/src/main/ipc.ts`

**Interfaces:**
- Produces: `createCodexCliProvider`, `buildCodexArgs`, and provider result parsing.
- Consumes: the shared `LocalAiProvider` contract and server-resolved run profile.

- [ ] Write failing tests for detection, fixed safe arguments, model/effort mapping, schema/result temp files, cancellation and malformed output.
- [ ] Run the focused adapter tests and confirm the adapter is missing.
- [ ] Implement `codex exec` with stdin, `shell: false`, read-only sandbox, ephemeral mode, ignored user config/rules and fresh temporary paths.
- [ ] Register `codex-cli` beside `claude-code`; do not add arbitrary executable configuration.
- [ ] Parse Codex JSONL usage when present, while treating the schema-constrained last-message file as the answer the server validates.
- [ ] Run desktop main-process tests and typecheck.

### Task 3: Independent provider settings and selection UI

**Files:**
- Modify: `apps/server/src/modules/ai/routes.ts`
- Modify: `apps/server/src/ai-security.integration.test.ts`
- Modify: `apps/desktop/src/renderer/src/routes/misc.tsx`
- Modify: `apps/desktop/src/renderer/src/features/ai/ai-toolbar.tsx`
- Test: `apps/desktop/src/renderer/src/features/ai/ai-toolbar.test.tsx`

**Interfaces:**
- Produces: provider-aware policy responses and run preparation.
- Consumes: provider catalog, local provider statuses and existing policy API.

- [ ] Write failing integration tests for independent enablement and invalid cross-provider model requests.
- [ ] Write a failing toolbar test showing provider changes reset model selection to that provider's default.
- [ ] Resolve and persist the selected provider's profile in server routes.
- [ ] Render one settings card per provider with independent visibility, models, efforts and isolation controls.
- [ ] Add provider selection to the toolbar and context preview.
- [ ] Run focused server and renderer tests.

### Task 4: Intake contracts and persistence

**Files:**
- Create: `packages/contracts/src/intake.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/db/src/schema/intake.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0003_ai_intake.sql`
- Test: `packages/contracts/src/intake.test.ts`

**Interfaces:**
- Produces: batch/item schemas, draft and citation schemas, create/update/reject/accept/merge requests, and Drizzle tables.

- [ ] Write failing contract tests for bounded drafts, valid statuses, confidence and immutable source metadata.
- [ ] Add contracts for `MANUAL | FOLDER_SCAN | EXTERNAL_AGENT` batches and `PENDING | ACCEPTED | REJECTED | MERGED` items.
- [ ] Add foreign keys, terminal-state checks, review metadata and indexes in migration `0003`.
- [ ] Export the schema and run focused tests/typecheck.

### Task 5: Intake API and canonical acceptance

**Files:**
- Create: `apps/server/src/modules/intake/routes.ts`
- Create: `apps/server/src/modules/intake/service.ts`
- Create: `apps/server/src/modules/intake/routes.integration.test.ts`
- Modify: `apps/server/src/routes.ts`

**Interfaces:**
- Produces: `GET /v1/intake?caseId=`, `POST /v1/intake/manual`, `PATCH /v1/intake/items/:id`, `/accept`, `/reject`, and `/merge`.
- Consumes: case access guards, `allocateReference`, findings, audit and events.

- [ ] Write failing integration tests for case visibility, writer-only mutation, pending edits, acceptance defaults, rejection reason and duplicate terminal decisions.
- [ ] Implement list and manual creation without touching canonical findings.
- [ ] Implement acceptance transaction: lock pending item, create finding from reviewed draft, record reviewer, audit both entities and publish changes after commit.
- [ ] Implement rejection and merge transactions; merge records the destination finding without overwriting canonical text.
- [ ] Verify readers cannot infer restricted-case intake and cannot mutate visible intake.
- [ ] Run intake and AI security integration tests.

### Task 6: Case-scoped intake review UI

**Files:**
- Create: `apps/desktop/src/renderer/src/features/intake/intake-panel.tsx`
- Create: `apps/desktop/src/renderer/src/features/intake/intake-panel.test.tsx`
- Create: `apps/desktop/src/renderer/src/features/intake/manual-intake-dialog.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/case-detail.tsx`
- Modify: `apps/desktop/src/renderer/src/lib/api.ts`

**Interfaces:**
- Produces: Intake case tab, pending count, manual draft form, inline edit, accept, reject and merge controls.
- Consumes: intake API contracts and existing Markdown/UI components.

- [ ] Write failing component tests for pending drafts, source/confidence display, edit-before-accept, rejection and terminal item removal.
- [ ] Add the Intake tab and manual entry action to the case workspace.
- [ ] Build the review panel with editable draft fields and citations displayed beside claims.
- [ ] Wire accept/reject/merge mutations and invalidate intake plus finding queries.
- [ ] Run focused DOM tests and desktop typecheck.

### Task 7: Security documentation and full verification

**Files:**
- Modify: `docs/architecture/ai-security.md`
- Modify: `README.md`

- [ ] Document Codex's sandbox/config isolation and the provider-specific policy boundary.
- [ ] Document intake as non-canonical and list the exact human review transition.
- [ ] Apply migrations to the development database.
- [ ] Run `bun run test`, the full integration project with `DATABASE_URL`, `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run build`.
- [ ] Inspect `git diff --check` and the final diff for accidental unrelated changes.
