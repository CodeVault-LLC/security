# CodeVault Security Research Platform Implementation Plan

**Status:** Historical implementation plan. It records the original build
sequence, not current completion. The [feature register](../../feature-register.md)
is the current inventory. Unchecked task boxes below are preserved as planning
history and must not be read as evidence that shipped work is missing.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Read this entire document before changing code.** This is a greenfield product specification, not a loose set of ideas. Preserve the architectural boundaries and security rules even when implementation details need adjustment.

**Goal:** Build a high-quality, cross-platform security research, finding-management, evidence, coordinated-disclosure, and reporting platform for CodeVault where AI performs repetitive research/writing work but humans approve canonical security facts and publications.

**Architecture:** Use an Electron desktop client as the primary researcher workstation, backed by a shared self-hosted server so CodeVault has one source of truth across the team. Store structured data in PostgreSQL, large artifacts in S3-compatible object storage, asynchronous jobs in PostgreSQL through `pg-boss`, and keep AI/terminal execution local to the researcher’s desktop by default through narrowly scoped provider adapters such as Claude Code.

**Tech Stack:** Electron, React, TypeScript, electron-vite, electron-builder, shadcn/ui, Tailwind CSS, Radix primitives through shadcn, Lucide icons, TanStack Router, TanStack Query, TanStack Table/Virtual, React Hook Form, TypeBox, Fastify, PostgreSQL 18+, Drizzle ORM, `pg_trgm`, PostgreSQL full-text search, optional `pgvector`, S3-compatible object storage, `pg-boss`, CodeMirror 6, Unified/Remark/Rehype, Paged.js, Playwright Chromium, Vitest, Testing Library, Playwright tests.

---

## 1. Product Definition

CodeVault is **not** a generic vulnerability-management suite and must not evolve into a DefectDojo clone.

It is a **security research and coordinated-disclosure operating system** optimized for people who discover vulnerabilities across heterogeneous targets such as software components, applications, APIs, devices, firmware, hardware, services, hosts, and cloud resources.

The primary workflow is:

```text
Research Case
    ↓
Assets + Research Notes + Evidence
    ↓
Finding
    ↓
Validation + Scoring + Prior-Art Check + Fact Checking
    ↓
Human Review
    ↓
Internal Report / Vendor Report / Public Disclosure
    ↓
Disclosure Timeline + Publication
```

The product must make small findings fast to manage while still being capable of handling embargoed zero-days, unauthenticated RCEs, firmware vulnerabilities, government-program requirements, large evidence sets, and multi-stage vendor disclosure.

---

## 2. Non-Negotiable Product Principles

1. **AI drafts; humans own truth.**
   - AI may propose text, classifications, CVSS vectors, CWE mappings, prior-art matches, affected-version conclusions, remediation text, and report rewrites.
   - AI must never silently mutate approved findings, scores, visibility labels, disclosure state, or reports.
   - Every AI result becomes a proposal with Accept / Edit / Reject.

2. **One source of truth, three publication views.**
   - Do not maintain independent copies of the internal, vendor, and public facts.
   - Reports are projections of the same research case.
   - Internal-only data must never be passed to the public-report generation context.

3. **Evidence and provenance are first-class.**
   - Claims must be traceable to evidence, external sources, or explicit human reasoning.
   - Uploaded files receive immutable IDs, SHA-256 hashes, visibility, metadata, and audit events.

4. **Do not flatten unlike assets into a weak “generic asset” form.**
   - Use standard top-level kinds such as `SOFTWARE_COMPONENT`, `APPLICATION`, `SERVICE`, `API`, `DEVICE`, `FIRMWARE`, `HARDWARE`, `HOST_SYSTEM`, `CLOUD_RESOURCE`, `NETWORK_SERVICE`, `REPOSITORY`, and `CONTAINER_IMAGE`.
   - “WordPress plugin” is not a top-level asset kind. A WordPress plugin is a `SOFTWARE_COMPONENT` with ecosystem/package/vendor identifiers.
   - An IoT product can be a `DEVICE` related to a `FIRMWARE` asset and supporting components.

5. **Power without visible bloat.**
   - Keep forms short by default.
   - Advanced metadata belongs behind progressive disclosure.
   - Case profiles expose only the workflow relevant to that case.

6. **Do not invent another opaque risk score.**
   - Support CVSS 4.0, CVSS 3.1, EPSS, KEV status, CWE, and future score/classification schemes.
   - Preserve each signal independently.
   - Never multiply unrelated metrics into a proprietary “CodeVault risk number.”

7. **Security research content is hostile content.**
   - Treat uploaded HTML, scripts, PDFs, archives, PoCs, binaries, firmware, captures, and Markdown as untrusted.
   - Never execute uploaded content in the Electron renderer.
   - Never expose Node.js APIs to the React renderer.

8. **No public registration.**
   - The first administrator is bootstrapped by an administrative CLI.
   - Additional users enter only through expiring, single-use invitations.

9. **No arbitrary shell from the renderer.**
   - Claude Code and other terminal-backed providers run through explicit adapters in the Electron main process.
   - Spawn executables with `shell: false`.
   - The renderer may request an approved AI action, never arbitrary command text.

10. **Reports are Markdown-first.**
    - Markdown is canonical.
    - Rich preview and PDF are generated representations.
    - AI polish creates diffs/revisions, never destructive overwrites.

---

## 3. V1 Scope

V1 is intentionally substantial. It must include all of the following before being considered a usable CodeVault platform:

- Cross-platform Electron desktop app.
- macOS, Windows, Fedora-compatible Linux packaging.
- Shared self-hosted server.
- Login, logout, sessions, admin-created invites, user administration.
- Admin / Member / Viewer roles.
- Case-level access restriction.
- Research Cases.
- Standardized Assets and asset relationships.
- Findings with independent validation, remediation, disclosure, and external-ID states.
- Affected versions/ranges.
- Evidence, screenshots, files, PoCs, hashes, metadata, visibility, previews.
- Research notes.
- CVSS 4.0 and 3.1.
- CWE and external identifiers.
- EPSS/KEV-compatible enrichment model.
- “Check Prior Art” / “Has this been found before?” workflow.
- External references and claim provenance.
- Claude Code local provider using `claude -p`.
- Pluggable AI provider interface for future terminal providers.
- AI proposals and audit history.
- Internal, Vendor, and Public reports.
- Markdown editor with live preview.
- Report section approval.
- AI report drafting, rewriting, and consistency review.
- TLP distribution marking.
- High-quality PDF generation.
- Disclosure contacts, timeline, embargo, CVE state.
- Search across cases, assets, findings, evidence metadata, and reports.
- Dashboard focused on actions/changes rather than vulnerability-count vanity metrics.
- Immutable audit history.
- Production packaging and security hardening.

---

## 4. Explicit Non-Goals for V1

Do **not** build these in V1:

- Generic questionnaire engine.
- Generic workflow designer.
- Generic dashboard/widget builder.
- Jira/Linear/ServiceNow bidirectional synchronization.
- Full scanner-ingestion ecosystem with hundreds of parsers.
- Built-in SAST/DAST scanner.
- Built-in exploit runner.
- Generic terminal emulator.
- Chat application.
- Multi-organization SaaS tenancy.
- Public signup.
- Public-facing customer portal.
- Mobile client.
- Automatic CVE issuance/submission.
- Automatic publication without human approval.
- Cloud embedding of restricted data by default.
- Arbitrary user-created executable plugins.
- AI model fine-tuning/training. “Fine-tune the report” means AI-assisted rewriting/polishing, not model training.

---

## 5. Repository Layout

Create a pnpm monorepo with this structure:

```text
codevault/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── index.ts
│   │   │   │   ├── windows.ts
│   │   │   │   ├── protocol.ts
│   │   │   │   ├── security.ts
│   │   │   │   ├── api-client.ts
│   │   │   │   ├── session-store.ts
│   │   │   │   ├── file-uploads.ts
│   │   │   │   └── agents/
│   │   │   │       ├── types.ts
│   │   │   │       ├── registry.ts
│   │   │   │       └── claude-code.ts
│   │   │   ├── preload/
│   │   │   │   ├── index.ts
│   │   │   │   └── contracts.ts
│   │   │   └── renderer/
│   │   │       ├── index.html
│   │   │       └── src/
│   │   │           ├── main.tsx
│   │   │           ├── app.tsx
│   │   │           ├── routes/
│   │   │           ├── features/
│   │   │           ├── components/
│   │   │           ├── hooks/
│   │   │           ├── lib/
│   │   │           └── styles/
│   │   ├── electron.vite.config.ts
│   │   └── electron-builder.yml
│   │
│   ├── server/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── app.ts
│   │       ├── config.ts
│   │       ├── auth/
│   │       ├── events/
│   │       ├── modules/
│   │       │   ├── users/
│   │       │   ├── cases/
│   │       │   ├── assets/
│   │       │   ├── findings/
│   │       │   ├── evidence/
│   │       │   ├── reports/
│   │       │   ├── disclosure/
│   │       │   ├── prior-art/
│   │       │   ├── ai/
│   │       │   ├── search/
│   │       │   └── audit/
│   │       └── plugins/
│   │
│   └── worker/
│       └── src/
│           ├── index.ts
│           ├── queue.ts
│           └── jobs/
│               ├── prior-art.ts
│               ├── intelligence-refresh.ts
│               ├── artifact-preview.ts
│               └── report-pdf.ts
│
├── packages/
│   ├── contracts/
│   │   └── src/
│   ├── core/
│   │   └── src/
│   │       ├── permissions.ts
│   │       ├── visibility.ts
│   │       ├── identifiers.ts
│   │       └── states.ts
│   ├── db/
│   │   ├── drizzle/
│   │   └── src/
│   │       ├── client.ts
│   │       ├── migrate.ts
│   │       └── schema/
│   │           ├── auth.ts
│   │           ├── cases.ts
│   │           ├── assets.ts
│   │           ├── findings.ts
│   │           ├── evidence.ts
│   │           ├── reports.ts
│   │           ├── disclosure.ts
│   │           ├── ai.ts
│   │           ├── audit.ts
│   │           └── index.ts
│   ├── standards/
│   │   └── src/
│   │       ├── cvss40.ts
│   │       ├── cvss31.ts
│   │       ├── cwe.ts
│   │       ├── tlp.ts
│   │       └── identifiers.ts
│   ├── reporting/
│   │   └── src/
│   │       ├── markdown.ts
│   │       ├── directives.ts
│   │       ├── lint.ts
│   │       ├── visibility.ts
│   │       ├── html.ts
│   │       ├── pdf.ts
│   │       └── templates/
│   ├── ai/
│   │   └── src/
│   │       ├── actions.ts
│   │       ├── schemas.ts
│   │       ├── context.ts
│   │       ├── prompts/
│   │       └── proposals.ts
│   └── ui/
│       └── src/
│           ├── components/
│           ├── tokens.css
│           └── index.ts
│
├── infra/
│   ├── docker-compose.yml
│   ├── server.Dockerfile
│   └── worker.Dockerfile
│
├── scripts/
│   ├── bootstrap-admin.ts
│   ├── seed-dev.ts
│   └── verify-env.ts
│
├── docs/
│   ├── architecture/
│   │   ├── threat-model.md
│   │   ├── data-model.md
│   │   ├── report-model.md
│   │   └── ai-security.md
│   └── superpowers/
│       └── plans/
│           └── 2026-08-15-codevault-security-research-platform.md
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.mjs
└── vitest.workspace.ts
```

---

## 6. Platform and Runtime Constraints

- Use Node.js 24 LTS for development/server tooling.
- Use the latest stable Electron version compatible with the selected electron-vite/electron-builder toolchain at bootstrap time and pin it in the lockfile.
- Use TypeScript strict mode everywhere.
- Use ESM unless a packaging dependency has a documented incompatibility.
- Use pnpm workspaces.
- Use PostgreSQL 18+ in development and deployment.
- Use UTC in storage; format in the user’s local timezone in the UI.
- IDs are UUIDv7 where supported by the application helper; otherwise UUIDv4. Never expose sequential database IDs.
- Human-facing references are separate from primary keys, for example:
  - `CASE-2026-0001`
  - `FIND-2026-0001`
  - `AST-000001`
  - `EVID-000001`
  - `POC-000001`
- Never use a CVE-looking internal identifier such as `CVE-...`.
- Store timestamps as `timestamptz`.
- Store core fields relationally; use `jsonb` for target-specific/extensible metadata.
- Store files in object storage, not PostgreSQL `bytea`.
- Keep all migrations under source control.

---

## 7. Domain Model

### 7.1 Users and access

Global roles:

```ts
type UserRole = "ADMIN" | "MEMBER" | "VIEWER";
```

Meaning:

- `ADMIN`: user/invite/system settings plus normal research permissions.
- `MEMBER`: create/edit research data and reports.
- `VIEWER`: read-only unless a future policy explicitly grants more.

Case access:

```ts
type CaseAccess = "READ" | "WRITE";
```

A restricted case may have an explicit allow-list. If a case has no explicit allow-list, normal role permissions apply.

Final report approval must record the approving user. Policy packs may require the approver to differ from the last editor.

### 7.2 Research Cases

```ts
type CaseProfile =
  | "STANDARD"
  | "COORDINATED_DISCLOSURE"
  | "CRITICAL_ZERO_DAY"
  | "PROGRAM";

type CaseStatus = "OPEN" | "PAUSED" | "CLOSED" | "ARCHIVED";
```

A Research Case contains the target context and everything needed to understand the research effort.

Required fields at creation:

- Title.
- Profile.
- Owner.
- Optional short summary.

Everything else is editable later.

### 7.3 Asset kinds

Use:

```ts
type AssetKind =
  | "SOFTWARE_COMPONENT"
  | "APPLICATION"
  | "SERVICE"
  | "API"
  | "DEVICE"
  | "FIRMWARE"
  | "HARDWARE"
  | "HOST_SYSTEM"
  | "CLOUD_RESOURCE"
  | "NETWORK_SERVICE"
  | "REPOSITORY"
  | "CONTAINER_IMAGE";
```

Do not add framework/ecosystem-specific top-level types such as `WORDPRESS_PLUGIN`.

A simple asset-create dialog contains:

1. Name.
2. Kind.
3. Vendor/Maintainer, optional.
4. Version/Model, optional.
5. External identifier, optional.
6. Notes, optional.

Advanced metadata is collapsed.

Identifier schemes must support at least:

```ts
type AssetIdentifierScheme =
  | "CPE23"
  | "PURL"
  | "SWID"
  | "REPOSITORY_URL"
  | "VENDOR_PRODUCT"
  | "MODEL"
  | "SERIAL"
  | "CUSTOM";
```

### 7.4 Asset relationships

```ts
type AssetRelationship =
  | "CONTAINS"
  | "DEPENDS_ON"
  | "RUNS_ON"
  | "EXPOSES"
  | "DEPLOYS_AS"
  | "FIRMWARE_FOR"
  | "BUILT_FROM"
  | "RELATED_TO";
```

Example:

```text
Device
└── FIRMWARE_FOR ← Firmware
    └── CONTAINS → Software Component
```

### 7.5 Findings

Do not use one overloaded status.

```ts
type ValidationState =
  | "DRAFT"
  | "REPRODUCED"
  | "PEER_REVIEWED"
  | "CONFIRMED"
  | "DISPUTED"
  | "INVALID";

type RemediationState =
  | "UNKNOWN"
  | "UNFIXED"
  | "FIX_PROPOSED"
  | "FIX_AVAILABLE"
  | "FIXED"
  | "FIX_VERIFIED"
  | "REGRESSED"
  | "NOT_APPLICABLE";

type DisclosureState =
  | "PRIVATE"
  | "CONTACT_PREPARED"
  | "VENDOR_CONTACTED"
  | "ACKNOWLEDGED"
  | "COORDINATING"
  | "EMBARGOED"
  | "PUBLIC";

type ExternalIdState =
  | "NONE"
  | "CVE_REQUESTED"
  | "CVE_RESERVED"
  | "CVE_PUBLISHED"
  | "VENDOR_ID_ASSIGNED";

type PriorArtState =
  | "UNCHECKED"
  | "NO_PRIOR_ART_FOUND"
  | "POSSIBLE_MATCH"
  | "LIKELY_KNOWN"
  | "CONFIRMED_KNOWN"
  | "HUMAN_CONFIRMED_NOVEL";
```

`HUMAN_CONFIRMED_NOVEL` must never be assigned by AI automatically.

Finding content fields:

- Title.
- Executive summary.
- Technical description.
- Attack preconditions.
- Attack path.
- Security impact.
- Reproduction steps.
- Remediation recommendation.
- Researcher notes.
- Affected assets/releases.
- Identifiers.
- Scores/classifications.
- Evidence.
- PoCs.
- References.
- Claims.
- Prior-art checks.

### 7.6 Visibility vs TLP

CodeVault content visibility:

```ts
type ContentVisibility = "INTERNAL" | "VENDOR" | "PUBLIC";
```

Distribution labels:

```ts
type TlpLabel =
  | "TLP:RED"
  | "TLP:AMBER+STRICT"
  | "TLP:AMBER"
  | "TLP:GREEN"
  | "TLP:CLEAR";
```

These are separate concepts.

Default report mappings:

- Internal: `INTERNAL`, default `TLP:RED`.
- Vendor: `VENDOR`, default `TLP:AMBER`, with `TLP:AMBER+STRICT` selectable.
- Public: `PUBLIC`, default `TLP:CLEAR`.

Evidence defaults to `INTERNAL`.

Promotion from `INTERNAL → VENDOR → PUBLIC` requires explicit human action.

AI context builders must filter data before it reaches the provider.

### 7.7 Evidence and artifacts

Artifact kinds:

```ts
type ArtifactKind =
  | "SCREENSHOT"
  | "IMAGE"
  | "HTTP_CAPTURE"
  | "HAR"
  | "PCAP"
  | "SOURCE_CODE"
  | "BINARY"
  | "FIRMWARE"
  | "DOCUMENT"
  | "POC"
  | "ARCHIVE"
  | "LOG"
  | "TERMINAL_OUTPUT"
  | "VIDEO"
  | "OTHER";
```

Every file record must include:

- Original filename.
- Opaque object-storage key.
- MIME type.
- Size.
- SHA-256.
- Artifact kind.
- Visibility.
- Uploader.
- Case.
- Optional finding.
- Capture/source timestamp.
- Metadata JSON.
- Created timestamp.

Never use the original filename as the object-storage key.

### 7.8 PoC records

A PoC is more than a file attachment.

Store:

- Title.
- Finding.
- Markdown instructions.
- Preconditions/environment.
- Expected result.
- Status: `DRAFT | VERIFIED | FAILED | RETIRED`.
- Tested asset/release.
- Last verified timestamp.
- Visibility.
- Linked artifacts.
- Verification-run records.

V1 records PoC executions; it does not execute arbitrary PoCs.

### 7.9 Claims

Claims provide evidence-backed facts:

```ts
interface Claim {
  id: string;
  findingId: string;
  key: string;
  statementMarkdown: string;
  value: unknown;
  sourceType: "EVIDENCE" | "EXTERNAL" | "HUMAN" | "AI_PROPOSAL";
  sourceRef: string | null;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "AUTHORITATIVE";
  visibility: ContentVisibility;
  reviewedBy: string | null;
  retrievedAt: string | null;
  expiresAt: string | null;
}
```

Examples:

- “Vendor version 4.1.7 contains the patch.”
- “This endpoint is reachable without authentication.”
- “CISA KEV includes CVE-XXXX-YYYY.”
- “EPSS probability is 0.43 as of DATE.”

### 7.10 Report audiences

```ts
type ReportAudience = "INTERNAL" | "VENDOR" | "PUBLIC";
type ReviewState =
  | "NOT_WRITTEN"
  | "AI_DRAFT"
  | "RESEARCHER_EDITED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "LOCKED";
```

Reports are composed of sections so each section can be independently drafted, edited, reviewed, approved, and invalidated if its source facts change.

---

## 8. Database Tables

Implement these table groups in Drizzle.

### Authentication

- `users`
- `invites`
- `sessions`

### Cases

- `cases`
- `case_members`
- `case_notes`
- `case_assets`
- `policy_packs`
- `case_policy_packs`

### Assets

- `assets`
- `asset_identifiers`
- `asset_versions`
- `asset_relationships`

### Findings

- `findings`
- `finding_assets`
- `affected_ranges`
- `finding_identifiers`
- `finding_scores`
- `claims`
- `references`
- `prior_art_checks`
- `prior_art_matches`

### Evidence

- `artifacts`
- `evidence`
- `pocs`
- `poc_artifacts`
- `poc_runs`

### Reports

- `report_templates`
- `reports`
- `report_sections`
- `report_revisions`
- `report_approvals`
- `report_exports`

### Disclosure

- `stakeholders`
- `disclosure_events`
- `embargoes`

### AI

- `ai_runs`
- `ai_proposals`
- `ai_provider_policies`

### Audit

- `audit_events`

### Search

Add generated/search-maintained `tsvector` columns where useful for:

- case title/summary.
- asset name/vendor/identifier text.
- finding title/summary/technical description.
- evidence title/description.
- report section Markdown.

Enable `pg_trgm` for fuzzy title/product matching.

Make `pgvector` optional and disabled by default. Do not require external embeddings for the app to work.

---

## 9. API Shape

Use `/v1`.

Required route groups:

```text
POST   /v1/auth/login
POST   /v1/auth/logout
GET    /v1/auth/me

GET    /v1/users
POST   /v1/invites
GET    /v1/invites
DELETE /v1/invites/:id
POST   /v1/invites/accept

GET    /v1/cases
POST   /v1/cases
GET    /v1/cases/:id
PATCH  /v1/cases/:id
POST   /v1/cases/:id/members
DELETE /v1/cases/:id/members/:userId

GET    /v1/assets
POST   /v1/assets
GET    /v1/assets/:id
PATCH  /v1/assets/:id
POST   /v1/assets/:id/identifiers
POST   /v1/assets/:id/versions
POST   /v1/assets/:id/relationships

GET    /v1/findings
POST   /v1/findings
GET    /v1/findings/:id
PATCH  /v1/findings/:id
POST   /v1/findings/:id/assets
POST   /v1/findings/:id/scores
POST   /v1/findings/:id/identifiers
POST   /v1/findings/:id/prior-art-checks
GET    /v1/findings/:id/prior-art-checks

POST   /v1/uploads
POST   /v1/uploads/:id/complete
GET    /v1/artifacts/:id
POST   /v1/evidence
PATCH  /v1/evidence/:id

POST   /v1/pocs
PATCH  /v1/pocs/:id
POST   /v1/pocs/:id/runs

GET    /v1/reports
POST   /v1/reports
GET    /v1/reports/:id
PATCH  /v1/reports/:id
PATCH  /v1/reports/:id/sections/:sectionId
POST   /v1/reports/:id/approve
POST   /v1/reports/:id/exports

GET    /v1/cases/:id/disclosure
POST   /v1/cases/:id/stakeholders
POST   /v1/cases/:id/disclosure-events
POST   /v1/cases/:id/embargo

POST   /v1/ai/runs
POST   /v1/ai/runs/:id/result
POST   /v1/ai/proposals/:id/accept
POST   /v1/ai/proposals/:id/reject

GET    /v1/search
GET    /v1/events
```

Use TypeBox schemas in `packages/contracts`. API request and response shapes must be shared with the desktop renderer; do not duplicate handwritten interfaces.

---

## 10. UI Information Architecture

### Sidebar

Keep the global sidebar compact:

```text
CodeVault

Home
Cases
Findings
Assets

Publishing
  Reports
  Disclosure

Activity

────────────
Settings
User
```

Do not add a separate top-level page for every database concept.

Use `Cmd/Ctrl+K` command palette for:

- Open case/finding/asset.
- Create case.
- Create finding.
- Upload evidence.
- Run “Check Prior Art.”
- Open report.
- Open settings.

### Case page

```text
Overview | Findings | Assets | Evidence | Research | Disclosure | Reports | Activity
```

Hide `Disclosure` for `STANDARD` cases until enabled.

### Finding page

```text
Overview | Technical | Evidence | PoC | Scoring | Prior Art | Disclosure | Reports | History
```

The top bar must always show:

- Finding reference.
- Title.
- Severity.
- Validation state.
- Disclosure state.
- Affected primary asset.
- Prior-art state.
- AI suggestions pending.

### Report page

Three primary report tabs for the case:

```text
Internal | Vendor | Public
```

Each shows:

- TLP label.
- completion/review progress.
- section outline.
- Markdown editor.
- preview.
- visibility warnings.
- AI actions.
- approval state.
- export controls.

---

## 11. Visual Design Requirements

The visual direction is **modern security analysis tool**, not generic admin dashboard and not neon “hacker” styling.

Use VirusTotal/Intezer-like qualities without copying either product:

- high information density with strong hierarchy.
- crisp bordered surfaces.
- restrained accent color.
- dense but readable tables.
- monospace for IDs, hashes, vectors, paths, and technical values.
- proportional UI font for body content.
- clear badges for severity/state/TLP.
- split-pane analysis layouts.
- contextual right-side inspector where useful.
- keyboard-first navigation.
- subtle transitions only.
- no giant marketing cards.
- no excessive gradients.
- no “cyberpunk” green-on-black motif.

### Theme system

Use CSS variables with OKLCH values and Tailwind tokens.

Required themes:

- Dark.
- Light.
- System.

Semantic tokens:

```text
background
surface
surface-raised
surface-hover
border
border-strong
text
text-muted
accent
focus
success
warning
danger
info

severity-critical
severity-high
severity-medium
severity-low
severity-info

tlp-red
tlp-amber
tlp-green
tlp-clear
```

Never communicate severity or state by color alone. Always include text/icon/shape.

Use shadcn/ui as the base component source, then customize wrappers in `packages/ui`. Do not scatter raw shadcn components through feature code when a CodeVault semantic component exists.

Examples:

- `SeverityBadge`
- `TlpBadge`
- `StateBadge`
- `EvidenceCard`
- `ReferenceLink`
- `ApprovalState`
- `AiProposalPanel`
- `HashValue`
- `AssetKindIcon`
- `FindingHeader`
- `ReportSectionStatus`

---

## 12. React Performance Rules

- TanStack Query owns server state.
- Zustand or equivalent small store may own only ephemeral desktop UI state.
- Do not mirror API records into a global state store.
- Use stable query keys.
- Use targeted invalidation from server events.
- Use optimistic updates only for low-risk reversible UI operations.
- Use route-level code splitting.
- Use `TanStack Virtual` for large finding/evidence/search lists.
- Use `TanStack Table` with server-side sorting/filtering for large datasets.
- Memoize expensive renderers, not every component by default.
- Debounce full-text searches.
- Keep Markdown editor state local to the report section being edited.
- Hash/upload large files outside the renderer.
- Never load complete multi-gigabyte evidence files into React memory.
- Use thumbnail/preview representations.
- Paginate activity/audit history.
- Avoid polling when server-sent events can invalidate data.
- Keep normal cached route changes visually immediate.

Performance acceptance targets on a typical modern developer workstation:

- cached sidebar navigation: no visible blocking spinner.
- filter/search typing: no perceptible input lag.
- 5,000-row virtualized list: smooth scrolling.
- 100 MB evidence upload: progress updates without renderer freezing.
- 200-page report preview generation: background job, UI remains interactive.

---

## 13. Electron Security Model

Electron is a privileged security boundary. Implement these rules from the first commit:

```ts
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    preload: preloadPath,
  },
});
```

Also:

- Call `app.enableSandbox()` before app readiness.
- Use a restrictive Content Security Policy.
- Use a custom local application protocol instead of relying on unrestricted `file://`.
- Block unexpected navigation.
- Block unexpected new windows.
- Validate sender origin for every IPC handler.
- Do not expose `ipcRenderer` directly.
- Do not expose `child_process`.
- Do not expose filesystem APIs directly.
- Do not render arbitrary remote websites in application windows.
- `shell.openExternal` must parse and allow only `https:` and `mailto:` targets after confirmation for untrusted links.
- Turn off unsafe Electron fuses where packaging supports it.
- Enable ASAR integrity where supported.
- Keep Electron on supported/current releases.

### Session storage

The raw opaque session token is owned by the Electron main process.

Use Electron `safeStorage` asynchronous APIs.

On Linux, if the selected storage backend degrades to an insecure/basic plaintext backend:

- do not persist the session token across restarts.
- show a warning explaining that secure credential storage is unavailable.
- require login on next launch.

The renderer never receives the raw session token.

---

## 14. Authentication Model

Do not use JWTs.

Use opaque 32-byte cryptographically random session tokens:

1. Generate raw token.
2. Store SHA-256(token) in PostgreSQL.
3. Send/store raw token only in Electron main-process secure storage.
4. Attach raw token as `Authorization: Bearer` from the main-process API client.
5. Server hashes incoming token and compares using indexed token hash.

Password storage:

- Argon2id.
- Enforce sensible minimum password length.
- Rate-limit login attempts by account and source.
- Audit successful/failed authentication.

Invite flow:

1. Admin creates invite for email + role.
2. Generate 32-byte random invite token.
3. Store only token hash.
4. Default expiry: 7 days.
5. Invite is single-use.
6. Invite acceptance sets display name and password.
7. There is no `/register` route.

Bootstrap:

```bash
pnpm admin:create --email admin@codevault.example --name "CodeVault Admin"
```

The CLI prompts for the password via hidden terminal input and writes only the Argon2id hash.

---

## 15. File Upload Architecture

Never send large files through JSON or base64.

Flow:

```text
Desktop main process
  ├── opens native file picker
  ├── streams SHA-256
  ├── POST /uploads with metadata
  ├── receives presigned S3 upload instructions
  ├── streams file directly to object storage
  ├── shows progress to renderer
  └── POST /uploads/:id/complete
```

Rules:

- Use opaque object keys.
- Store original filename only in DB.
- Store SHA-256 in DB.
- Verify object exists and size matches before marking complete.
- Default max file size: 10 GiB, configurable.
- Use multipart upload for large files.
- Never execute uploaded content.
- Never serve artifacts from public buckets.
- Downloads require authenticated short-lived presigned URLs.
- Audit artifact downloads for restricted cases.

Preview generation:

- Images: safe thumbnail generation.
- Text/source/log: bounded text preview.
- PDF: render through PDF.js or isolated preview worker; never execute embedded active content.
- Archives/binaries/firmware/PoCs: metadata only in V1 unless an explicit safe previewer exists.
- SVG: treat as potentially active content; sanitize or rasterize before inline preview.

---

## 16. “Has This Been Found Before?” / Prior-Art Workflow

Every finding page must expose a prominent button:

```text
Check Prior Art
```

The button must not be labeled “AI says zero-day.”

### Stage A: deterministic internal search

Search CodeVault first using:

- normalized asset identity.
- CPE/PURL where available.
- vendor/product.
- title trigrams.
- CWE.
- affected component.
- technical keywords.
- endpoint/function/path where available.

Show internal matches immediately.

### Stage B: structured external search

Create provider adapters under:

```text
apps/worker/src/jobs/prior-art/
packages/core/src/prior-art/
```

Initial providers:

- NVD/CVE data.
- CVE Records/CVE List data.
- GitHub Security Advisories when configured.
- OSV when package identity can be mapped.
- Vendor advisory/web-search adapter when configured.

Every external result stores:

- provider.
- external ID.
- title.
- URL.
- publisher.
- published date.
- affected identity.
- short normalized summary.
- query that produced it.
- retrieval timestamp.

### Stage C: AI synthesis

If an approved AI provider is configured, build a context containing only the normalized search results and the finding facts needed to compare them.

AI returns structured data:

```ts
interface PriorArtAnalysis {
  conclusion:
    | "NO_OBVIOUS_MATCH"
    | "POSSIBLE_MATCH"
    | "LIKELY_SAME_ROOT_CAUSE"
    | "LIKELY_DIFFERENT";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reasoning: string;
  matches: Array<{
    matchId: string;
    relationship: "SAME" | "RELATED" | "DIFFERENT";
    reasoning: string;
  }>;
  missingChecks: string[];
}
```

The AI result is advisory.

Human buttons:

```text
Mark Known
Mark Possible Match
No Prior Art Found
Human Confirmed Novel
```

“No Prior Art Found” means exactly that: the checked sources returned no convincing match as of the recorded date. It is not an absolute statement that the vulnerability has never existed.

### Prior-art UI

Show:

- checked sources.
- exact queries.
- retrieval timestamps.
- candidate matches.
- AI comparison.
- human conclusion.
- rerun button.
- differences between previous and latest check.

---

## 17. Scoring and Classification

### CVSS 4.0

Use a maintained JavaScript/TypeScript CVSS implementation and validate it against FIRST’s published reference vectors.

Store:

- vector.
- deterministic score.
- metric JSON.
- source: AI proposal / human / external.
- reasoning Markdown.
- review state.
- reviewer.
- timestamp.

AI flow:

```text
Suggest CVSS
    ↓
AI proposes each metric + evidence/reasoning
    ↓
Researcher reviews metric-by-metric
    ↓
Deterministic library computes final score
    ↓
Approved vector + score stored
```

Do not let AI directly invent the numeric score.

### CVSS 3.1

Support the same pattern for compatibility with vendors/programs still requiring 3.1.

### CWE

AI may suggest one or more CWE candidates with reasons and links. Human chooses/approves.

### EPSS / KEV

The schema supports external intelligence before the first UI release.

When a CVE exists:

- worker may refresh EPSS.
- worker may refresh KEV status.
- keep source and retrieval timestamp.
- display stale-data warning according to configured refresh policy.

Do not merge EPSS into CVSS.

---

## 18. AI Architecture

### Provider interface

Create:

```ts
export interface LocalAiProvider {
  id: string;
  displayName: string;
  detect(): Promise<{
    available: boolean;
    version?: string;
    executable?: string;
  }>;
  run(input: AiRunInput): Promise<AiRunResult>;
}
```

`AiRunInput` contains:

```ts
interface AiRunInput {
  action: AiActionId;
  prompt: string;
  workingDirectory?: string;
  timeoutMs: number;
  environmentAllowlist: string[];
}
```

### Claude Code adapter

Implement `claude -p` as the first adapter.

Rules:

- Resolve executable once in settings/detection.
- Use `child_process.spawn`.
- `shell: false`.
- Do not concatenate a shell command.
- Capture stdout/stderr.
- Support cancellation.
- Apply timeout.
- Record executable version.
- Record working directory.
- Redact configured secrets from logs before upload.
- Do not expose environment wholesale.

### AI actions

Implement fixed action IDs:

```ts
type AiActionId =
  | "FINDING_DRAFT_TITLE"
  | "FINDING_DRAFT_SUMMARY"
  | "FINDING_DRAFT_TECHNICAL"
  | "FINDING_DRAFT_IMPACT"
  | "FINDING_DRAFT_REMEDIATION"
  | "FINDING_SUGGEST_CWE"
  | "FINDING_SUGGEST_CVSS40"
  | "FINDING_SUGGEST_CVSS31"
  | "FINDING_FACT_CHECK"
  | "FINDING_PRIOR_ART_SYNTHESIS"
  | "REPORT_DRAFT_SECTION"
  | "REPORT_POLISH_SECTION"
  | "REPORT_CONSISTENCY_REVIEW"
  | "REPORT_LEAK_REVIEW"
  | "AFFECTED_VERSION_REVIEW";
```

The renderer requests an action ID and target IDs, not an arbitrary shell string.

### AI proposals

Every canonical mutation from AI is represented as:

```ts
interface AiProposal {
  id: string;
  runId: string;
  targetType: "FINDING" | "SCORE" | "CLAIM" | "REPORT_SECTION";
  targetId: string;
  patch: Record<string, unknown>;
  rationaleMarkdown: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
}
```

Accepting a proposal:

- validates permissions.
- validates current target version to prevent stale overwrite.
- applies patch in transaction.
- writes audit event.
- records reviewer.

### AI data policy

Add workspace-level provider policy:

```ts
interface AiProviderPolicy {
  providerId: string;
  enabled: boolean;
  allowedVisibility: ContentVisibility[];
  allowRestrictedCases: boolean;
}
```

Before every AI run:

- build exact context.
- apply visibility policy.
- show “View context being sent” in UI.
- persist input manifest hashes.
- never send disallowed evidence.

---

## 19. Report Architecture

Markdown is canonical.

### Report templates

Ship three built-in templates:

1. `CODEVAULT_INTERNAL_V1`
2. `CODEVAULT_VENDOR_V1`
3. `CODEVAULT_PUBLIC_V1`

Templates define:

- audience.
- default TLP.
- ordered sections.
- required/optional sections.
- section prompt purpose.
- visibility ceiling.
- required data checks.
- PDF theme.

### Internal template

Suggested sections:

```text
Executive Summary
Research Context
Target / Asset
Affected Versions
Technical Analysis
Attack Preconditions
Attack Path
Impact
Reproduction
Proof of Concept
Evidence
Scoring and Classification
Alternative Exploitation / Failed Hypotheses
Remediation Analysis
Prior Art / Related Vulnerabilities
Vendor / Stakeholder Context
Disclosure Strategy
Disclosure Timeline
References
Appendices
```

### Vendor template

Suggested sections:

```text
Executive Summary
Affected Product
Affected Versions
Severity and CVSS
Vulnerability Description
Security Impact
Attack Preconditions
Technical Details
Reproduction Steps
Proof of Concept
Recommended Remediation
Supporting Evidence
Disclosure Timeline
References
Contact
```

### Public template

Suggested sections:

```text
Summary
Affected Products
Affected Versions
Identifiers
Severity
Technical Description
Impact
Exploitation Requirements
Remediation / Fixed Versions
Technical Analysis
Disclosure Timeline
Credits
References
```

### Markdown directives

Support safe application directives:

```markdown
[evidence:EVID-000123]
[asset:AST-000012]
[finding:FIND-2026-0012]
[reference:REF-00042]
[score:CVSS40]
[disclosure-timeline]
```

The Markdown renderer resolves these through structured data.

Unknown directives must render as visible errors in preview/export rather than silently disappearing.

### Report editing

Use CodeMirror 6.

UI:

- section tree left.
- Markdown editor center.
- live preview right or toggleable.
- AI actions above editor.
- section approval status.
- source/evidence references.
- visibility indicator.

AI “polish” must create a diff:

```text
Original | Proposed
```

Buttons:

```text
Accept all
Accept selected changes
Edit proposal
Reject
```

Never replace approved content silently.

---

## 20. Report Visibility Enforcement

This is a security control, not only UI.

Create:

```ts
function canInclude(
  itemVisibility: ContentVisibility,
  audience: ReportAudience
): boolean;
```

Rules:

- INTERNAL may consume INTERNAL, VENDOR, PUBLIC.
- VENDOR may consume VENDOR, PUBLIC.
- PUBLIC may consume PUBLIC only.

Before report AI context building, filter at the server/domain layer.

Before report export, run the same rule again.

A public report export must fail if its Markdown references an INTERNAL or VENDOR-only evidence directive.

Tests must prove this.

---

## 21. Report Linter

Run before approval and export.

Checks:

- required sections present.
- unresolved directives.
- unapproved AI sections.
- stale approved sections whose source facts changed.
- references to disallowed visibility.
- missing affected-version conclusion.
- score/vector mismatch.
- missing CVSS vector when score shown.
- CVE mismatch between report metadata and finding.
- internal hostname patterns in public report.
- likely credentials/API keys.
- internal-only filenames.
- private IP addresses in public report unless explicitly allow-listed.
- “TLP:RED” content included in public report.
- PoC referenced but not approved for audience.
- vendor claims presented as CodeVault-verified facts without a source distinction.

Lint results:

```ts
type LintSeverity = "INFO" | "WARNING" | "ERROR" | "BLOCKING";
```

Only `BLOCKING` prevents export.

---

## 22. PDF Compilation Pipeline

Pipeline:

```text
Approved Markdown
    ↓
Resolve CodeVault directives
    ↓
Remark Markdown AST
    ↓
Rehype HTML AST
    ↓
Sanitize
    ↓
CodeVault report HTML template
    ↓
Paged.js pagination
    ↓
Playwright Chromium
    ↓
Tagged PDF + outline where available
    ↓
SHA-256
    ↓
Object storage + report_exports row
```

Required PDF features:

- A4 default.
- cover page.
- CodeVault branding.
- title, reference, date.
- TLP marking in page header/footer.
- page numbers.
- consistent heading hierarchy.
- code blocks with controlled wrapping.
- tables that remain readable.
- figure/evidence captions.
- hyperlinks.
- PDF outline/bookmarks.
- selectable text.
- print backgrounds where the theme requires them.
- metadata title/author/subject.
- deterministic template version recorded with export.

The PDF worker must run without external network access during rendering.

Never let report Markdown load remote JavaScript, CSS, images, or fonts during PDF rendering. External images must be explicitly imported as artifacts first.

---

## 23. Disclosure Subsystem

Each case can have:

- stakeholders.
- vendor/security contacts.
- first-contact timestamp.
- acknowledgement timestamp.
- expected response date.
- embargo start/end.
- planned disclosure date.
- CVE status.
- vendor reference.
- disclosure events.
- attached correspondence artifacts.

Timeline event types:

```ts
type DisclosureEventType =
  | "DISCOVERED"
  | "REPRODUCED"
  | "PEER_REVIEWED"
  | "VENDOR_CONTACTED"
  | "VENDOR_ACKNOWLEDGED"
  | "DETAILS_SENT"
  | "POC_SENT"
  | "PATCH_RECEIVED"
  | "PATCH_VERIFIED"
  | "CVE_REQUESTED"
  | "CVE_RESERVED"
  | "PUBLICATION_SCHEDULED"
  | "PUBLISHED"
  | "CUSTOM";
```

Generate disclosure timeline Markdown from structured events.

Do not force disclosure UI onto standard cases that do not need it.

---

## 24. Dashboard

The dashboard leads with a compact quantitative strip, then the operational
lists.

> **Revised 2026-08-16.** This section previously read "the dashboard is
> operational, not a severity pie-chart collection", and ended "severity totals
> can exist as a secondary compact widget, never the primary dashboard". The
> concern behind that wording still stands, but it was aimed at the wrong
> target: what makes a dashboard useless is a wall of donuts standing in for an
> operational view, not the presence of quantity. A dense strip — a stacked
> severity bar, a 90-day intake line, a disclosure breakdown — is read in about
> a second and then scrolled past, and it answers "is my intake accelerating?",
> which no list on this page ever could. See
> `docs/superpowers/specs/2026-08-16-metrics-and-charts-design.md`.
>
> What has *not* changed: Needs Attention and What Changed remain the working
> half of the page and are never displaced or abbreviated, and no chart here is
> a vanity metric or a derived risk score.

Show, in this order:

```text
Headline figures
- open findings
- criticals unfixed
- open cases
- median vendor acknowledgement (suppressed below three cases)

Charts
- severity distribution (stacked, always with a legend and counts)
- intake over the last 90 days
- disclosure posture
```

Then show:

```text
Needs Attention
- vendor responses due
- disclosure dates approaching
- critical private findings
- findings awaiting peer review
- reports awaiting approval
- stale affected-version verification
- prior-art checks not run
- failed background jobs
```

Also show:

```text
What Changed
- new findings
- changed remediation status
- vendor acknowledgement
- patch verified
- new CVE assignment
- KEV/EPSS enrichment change
```

The deeper analytics — validation funnel, disclosure timing, weakness classes,
prior-art novelty, most affected assets — live on their own Metrics destination
rather than on this page, so the homepage stays readable.

---

## 25. Search

Global search must handle:

- case refs/titles.
- finding refs/titles/descriptions.
- asset names/vendors/identifiers.
- CVE/CWE.
- file names/hashes.
- evidence descriptions.
- report text.

Implementation:

- PostgreSQL `tsvector` for full text.
- trigram search for typo-tolerant names/titles.
- exact matching prioritized for hashes, CVE, CPE, PURL, refs.
- optional vector similarity later.

Search result groups:

```text
Cases
Findings
Assets
Evidence
Reports
```

Keyboard navigation is mandatory.

---

## 26. Audit Model

Every sensitive mutation writes an append-only audit event containing:

- actor.
- device/session ID where available.
- action.
- entity type.
- entity ID.
- request ID.
- timestamp.
- before snapshot or relevant changed fields.
- after snapshot or relevant changed fields.
- AI run ID if applicable.

Audit at least:

- login/logout.
- invite creation/acceptance/revocation.
- case membership changes.
- finding state changes.
- visibility changes.
- evidence uploads/downloads/deletes.
- score approval.
- AI proposal acceptance/rejection.
- report approval.
- report export.
- disclosure-date changes.
- user disablement.

The normal application API cannot update/delete audit events.

---

# Implementation Tasks

## Task 1: Bootstrap the Monorepo and Quality Gates

**Files:**
- Create: root workspace files from the repository layout.
- Create: `apps/desktop/package.json`
- Create: `apps/server/package.json`
- Create: `apps/worker/package.json`
- Create package manifests for every `packages/*`.
- Create: `.github/workflows/ci.yml` if GitHub is used.

**Interfaces:**
- Produces: common TypeScript, lint, format, test, build commands used by all later tasks.

- [ ] **Step 1: Initialize workspace**

Create pnpm workspace and root scripts:

```json
{
  "private": true,
  "packageManager": "pnpm@10",
  "engines": {
    "node": ">=24 <25"
  },
  "scripts": {
    "dev": "pnpm -r --parallel --filter './apps/*' dev",
    "build": "pnpm -r build",
    "test": "vitest --run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "format": "prettier --write ."
  }
}
```

- [ ] **Step 2: Enable strict TypeScript**

Base compiler requirements:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "skipLibCheck": false
  }
}
```

- [ ] **Step 3: Add lint/format/test tooling**

Install ESLint, typescript-eslint, Prettier, Vitest, Testing Library packages, and Playwright.

- [ ] **Step 4: Add CI gates**

CI must run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 5: Verify**

Expected: all commands pass on an empty scaffold.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: bootstrap CodeVault monorepo"
```

---

## Task 2: Build the Secure Electron Shell

**Files:**
- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/windows.ts`
- Create: `apps/desktop/src/main/security.ts`
- Create: `apps/desktop/src/main/protocol.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/preload/contracts.ts`
- Test: `apps/desktop/src/main/security.test.ts`

**Interfaces:**
- Produces: `createMainWindow()`, validated preload bridge, custom protocol, security policy.

- [ ] **Step 1: Write a test for allowed navigation**

Test that only the local CodeVault application origin is allowed in the primary window and external `https:` links route through the safe external-link handler.

- [ ] **Step 2: Implement BrowserWindow security settings**

Use:

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  preload,
}
```

- [ ] **Step 3: Enable global sandbox and CSP**

Register restrictive permissions handler and CSP.

- [ ] **Step 4: Create narrow preload API**

Initial exposed API:

```ts
interface CodeVaultDesktopApi {
  app: {
    version(): Promise<string>;
    platform(): Promise<"darwin" | "win32" | "linux">;
  };
  auth: {
    login(email: string, password: string): Promise<AuthResult>;
    logout(): Promise<void>;
  };
}
```

Do not expose raw IPC methods.

- [ ] **Step 5: Run tests**

Expected: navigation/security tests pass.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add hardened Electron shell"
```

---

## Task 3: Build the Design System and App Shell

**Files:**
- Create: `packages/ui/src/tokens.css`
- Create semantic UI components listed in the design section.
- Create: `apps/desktop/src/renderer/src/components/app-sidebar.tsx`
- Create: `apps/desktop/src/renderer/src/components/app-shell.tsx`
- Create: `apps/desktop/src/renderer/src/routes/__root.tsx`
- Test: `packages/ui/src/components/*.test.tsx`

**Interfaces:**
- Produces: reusable CodeVault visual components and global layout.

- [ ] **Step 1: Initialize shadcn/ui and Tailwind**

Add required primitives: button, input, textarea, dialog, sheet, dropdown-menu, command, tabs, tooltip, popover, select, checkbox, table, badge, separator, scroll-area, skeleton, alert-dialog, toast/sonner.

- [ ] **Step 2: Define theme tokens**

Implement dark/light/system themes with semantic variables. Do not hard-code severity colors directly inside feature components.

- [ ] **Step 3: Build semantic security components**

At minimum:

```text
SeverityBadge
TlpBadge
StateBadge
HashValue
EvidenceCard
ApprovalState
AiProposalPanel
AssetKindIcon
```

- [ ] **Step 4: Build sidebar and command palette**

Use the information architecture in this plan.

- [ ] **Step 5: Add visual regression/snapshot tests**

Test badges in all semantic states and light/dark themes.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add CodeVault design system and app shell"
```

---

## Task 4: PostgreSQL, Drizzle, Object Storage, and Job Queue

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `apps/worker/src/queue.ts`
- Create: `apps/server/src/config.ts`
- Test: `packages/db/src/client.integration.test.ts`

**Interfaces:**
- Produces: `db`, migration runner, S3 client configuration, `pg-boss` queue.

- [ ] **Step 1: Create development infrastructure**

Docker Compose services:

- PostgreSQL 18.
- S3-compatible object storage for development.

Do not add Redis.

- [ ] **Step 2: Enable PostgreSQL extensions**

Migration:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Keep pgvector extension optional behind deployment config.

- [ ] **Step 3: Configure Drizzle**

Use `pg`/node-postgres and connection pooling.

- [ ] **Step 4: Configure pg-boss**

Worker uses the same PostgreSQL instance and its own queue schema.

- [ ] **Step 5: Test database connectivity and transaction rollback**

Integration test creates a temporary record in a transaction, rolls back, verifies absence.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add PostgreSQL storage and job infrastructure"
```

---

## Task 5: Implement Authentication, Sessions, Invites, and Users

**Files:**
- Create: `packages/db/src/schema/auth.ts`
- Create: `apps/server/src/auth/session.ts`
- Create: `apps/server/src/auth/password.ts`
- Create: `apps/server/src/modules/users/routes.ts`
- Create: `scripts/bootstrap-admin.ts`
- Create: `apps/desktop/src/main/session-store.ts`
- Create login/invite/user-management renderer features.
- Tests for login, no-register behavior, invite expiry, session revocation.

**Interfaces:**
- Produces: `requireUser`, `requireAdmin`, `createInvite`, `acceptInvite`.

- [ ] **Step 1: Write schema**

Implement `users`, `invites`, `sessions`.

- [ ] **Step 2: Write failing auth tests**

Required tests:

- valid login succeeds.
- invalid password fails.
- disabled user fails.
- expired invite fails.
- reused invite fails.
- no public registration route exists.
- revoked session fails.

- [ ] **Step 3: Implement Argon2id password hashing**

Never log passwords.

- [ ] **Step 4: Implement opaque session tokens**

Only token hashes exist server-side.

- [ ] **Step 5: Implement Electron secure session storage**

Use async `safeStorage`. Fail closed on Linux insecure/basic storage by making the session non-persistent.

- [ ] **Step 6: Implement admin invite UI**

Admin can create, copy, revoke and inspect invitations.

- [ ] **Step 7: Verify all auth tests**

- [ ] **Step 8: Commit**

```bash
git commit -am "feat: add invitation-only authentication"
```

---

## Task 6: Implement Research Cases and Permissions

**Files:**
- Create: `packages/db/src/schema/cases.ts`
- Create: `packages/core/src/permissions.ts`
- Create: `apps/server/src/modules/cases/routes.ts`
- Create: `apps/desktop/src/renderer/src/features/cases/*`
- Tests: API permission tests and renderer tests.

**Interfaces:**
- Produces: `canReadCase`, `canWriteCase`, case CRUD.

- [ ] **Step 1: Write permission tests**

Cover Admin/Member/Viewer and restricted case membership.

- [ ] **Step 2: Implement case schema**

Fields include ref, title, summary, profile, status, owner, restricted flag, timestamps.

- [ ] **Step 3: Implement case create/list/detail API**

List queries must respect case access.

- [ ] **Step 4: Implement simple create dialog**

Only ask title, profile, optional summary.

- [ ] **Step 5: Build case detail shell**

Tabs from the UI section; conditional disclosure tab.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add research cases and case access control"
```

---

## Task 7: Implement Standardized Assets

**Files:**
- Create: `packages/db/src/schema/assets.ts`
- Create: `packages/contracts/src/assets.ts`
- Create: `apps/server/src/modules/assets/routes.ts`
- Create: `apps/desktop/src/renderer/src/features/assets/*`
- Tests: asset-kind and relationship tests.

**Interfaces:**
- Produces: asset CRUD, identifiers, versions, relationships.

- [ ] **Step 1: Implement AssetKind exactly as specified**

Do not add `WORDPRESS_PLUGIN`.

- [ ] **Step 2: Implement identifiers and versions**

Support multiple identifiers and versions per asset.

- [ ] **Step 3: Implement relationships**

Reject self-relationships and duplicate identical relationships.

- [ ] **Step 4: Implement the simple asset-create form**

Advanced metadata remains collapsed.

- [ ] **Step 5: Build asset detail page**

Show identity, versions, relationships, findings, and metadata.

- [ ] **Step 6: Add example test fixtures**

Fixture examples:

- Hummingbird Performance as `SOFTWARE_COMPONENT`.
- a network camera as `DEVICE`.
- its firmware as `FIRMWARE` linked via `FIRMWARE_FOR`.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add standardized security asset model"
```

---

## Task 8: Implement Findings, Affected Versions, and Independent States

**Files:**
- Create: `packages/db/src/schema/findings.ts`
- Create: `packages/core/src/states.ts`
- Create: `apps/server/src/modules/findings/routes.ts`
- Create: `apps/desktop/src/renderer/src/features/findings/*`
- Tests: lifecycle/state tests.

**Interfaces:**
- Produces: finding CRUD and lifecycle transitions.

- [ ] **Step 1: Add finding schema**

Use independent validation, remediation, disclosure, external ID, and prior-art state columns.

- [ ] **Step 2: Implement affected asset/range model**

Support:

- exact version.
- semver range.
- custom vendor range expression.
- confirmed vulnerable.
- inferred affected.
- confirmed fixed/not vulnerable.

- [ ] **Step 3: Build quick-create finding dialog**

Fields:

- case.
- title.
- affected asset.
- short summary.
- optional initial severity.

Do not make the user fill 30 fields to create a finding.

- [ ] **Step 4: Build finding workspace**

Tabs from the UI section.

- [ ] **Step 5: Add state-change auditing**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add findings and vulnerability lifecycle model"
```

---

## Task 9: Implement Evidence, Artifact Uploads, and PoCs

**Files:**
- Create: `packages/db/src/schema/evidence.ts`
- Create: `apps/server/src/modules/evidence/routes.ts`
- Create: `apps/desktop/src/main/file-uploads.ts`
- Create: `apps/worker/src/jobs/artifact-preview.ts`
- Create renderer evidence/PoC components.
- Tests for hash, visibility, upload completion, and restricted download.

**Interfaces:**
- Produces: upload session API, artifact records, evidence, PoCs.

- [ ] **Step 1: Write upload integrity tests**

Reject completion when expected object size does not match.

- [ ] **Step 2: Implement native desktop file selection and streamed SHA-256**

Renderer receives progress events only.

- [ ] **Step 3: Implement presigned object upload**

No base64.

- [ ] **Step 4: Implement safe preview jobs**

Images and bounded text first.

- [ ] **Step 5: Implement PoC records**

PoC verification is a recorded event, not an arbitrary execution engine.

- [ ] **Step 6: Implement drag-insert of evidence reference into report/finding Markdown where safe**

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add evidence vault and proof-of-concept records"
```

---

## Task 10: Implement CVSS, CWE, and Security Intelligence Structures

**Files:**
- Create: `packages/standards/src/cvss40.ts`
- Create: `packages/standards/src/cvss31.ts`
- Create: `packages/standards/src/cwe.ts`
- Create scoring UI.
- Tests using published CVSS reference vectors.

**Interfaces:**
- Produces: deterministic `calculateCvss40(vector)` and `calculateCvss31(vector)`.

- [ ] **Step 1: Integrate maintained JS/TS CVSS implementation**

Wrap it behind CodeVault functions so it can be replaced without touching UI.

- [ ] **Step 2: Validate against FIRST vectors**

A mismatch fails CI.

- [ ] **Step 3: Build metric-by-metric editor**

Each metric shows:

- current value.
- AI suggested value.
- reasoning.
- evidence links.
- confidence.
- accept/change control.

- [ ] **Step 4: Add generic score-record storage**

Support CVSS, EPSS, SSVC/future types without schema redesign.

- [ ] **Step 5: Add CWE lookup/suggestion field**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add vulnerability scoring and classification"
```

---

## Task 11: Implement Prior-Art Checking

**Files:**
- Create prior-art contracts.
- Create worker provider adapters.
- Create API routes.
- Create finding Prior Art tab.
- Tests with mocked external providers.

**Interfaces:**
- Produces: `startPriorArtCheck(findingId)`, stored matches, human conclusion.

- [ ] **Step 1: Implement internal matching query**

Use exact identifiers, normalized product identity, FTS and trigram similarity.

- [ ] **Step 2: Implement external provider interface**

```ts
interface PriorArtProvider {
  id: string;
  search(input: PriorArtQuery): Promise<PriorArtProviderResult[]>;
}
```

- [ ] **Step 3: Implement structured external adapters**

At minimum NVD/CVE data; package/advisory providers activate when identifiers allow them.

- [ ] **Step 4: Build `Check Prior Art` UI**

Show deterministic results even when AI is unavailable.

- [ ] **Step 5: Add human conclusion controls**

AI cannot set `HUMAN_CONFIRMED_NOVEL`.

- [ ] **Step 6: Add rerun/diff support**

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add prior-art and known-vulnerability checking"
```

---

## Task 12: Implement Local Claude Code AI and Proposal Workflow

**Files:**
- Create: `apps/desktop/src/main/agents/types.ts`
- Create: `apps/desktop/src/main/agents/registry.ts`
- Create: `apps/desktop/src/main/agents/claude-code.ts`
- Create: `packages/ai/src/actions.ts`
- Create: `packages/ai/src/schemas.ts`
- Create: `packages/ai/src/context.ts`
- Create AI DB/API files.
- Tests: process invocation, timeout, invalid output, proposal conflict.

**Interfaces:**
- Produces: fixed AI actions and auditable proposals.

- [ ] **Step 1: Detect Claude Code**

Run version detection without shell interpolation.

- [ ] **Step 2: Implement `claude -p` adapter**

Capture stdout/stderr, timeout, cancellation and version.

- [ ] **Step 3: Add AI action registry**

Renderer can invoke only registered action IDs.

- [ ] **Step 4: Add structured output validation**

Invalid model output cannot directly become a proposal.

- [ ] **Step 5: Add proposal UI**

Show proposed field changes and rationale.

- [ ] **Step 6: Enforce visibility/provider policy before execution**

- [ ] **Step 7: Add “View context being sent”**

- [ ] **Step 8: Commit**

```bash
git commit -am "feat: add auditable Claude Code AI workflows"
```

---

## Task 13: Implement AI Fact Checking and AI CVSS/CWE/Prior-Art Actions

**Files:**
- Create prompt files under `packages/ai/src/prompts/`.
- Create AI action handlers.
- Add finding AI toolbar.
- Tests for context filtering and proposal types.

**Interfaces:**
- Consumes: AI provider from Task 12.
- Produces: finding draft/review actions.

- [ ] **Step 1: Implement fact-check prompt**

Output must distinguish:

- verified by internal evidence.
- supported by external source.
- conflicting sources.
- unsupported claim.
- stale source.
- needs researcher verification.

- [ ] **Step 2: Implement CVSS suggestion**

AI outputs metrics/reasoning, never authoritative numeric score.

- [ ] **Step 3: Implement CWE suggestion**

Return ranked candidates.

- [ ] **Step 4: Implement prior-art synthesis**

Only consume stored search results plus allowed finding context.

- [ ] **Step 5: Implement affected-version review**

Highlight untested assumptions.

- [ ] **Step 6: Add AI toolbar to finding**

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add AI-assisted security analysis"
```

---

## Task 14: Implement Markdown Reports and Section Review

**Files:**
- Create report DB schema.
- Create report templates.
- Create: `packages/reporting/src/markdown.ts`
- Create: `packages/reporting/src/directives.ts`
- Create report API routes.
- Create report editor UI.
- Tests for directives, revisions, approvals.

**Interfaces:**
- Produces: report sections/revisions/templates.

- [ ] **Step 1: Create built-in report templates**

Internal, Vendor, Public exactly as defined.

- [ ] **Step 2: Implement CodeMirror Markdown editor**

Add formatting commands for headings, lists, tables, code and evidence references.

- [ ] **Step 3: Implement directive parser**

Unknown directive = visible error.

- [ ] **Step 4: Implement section revisions**

Every save increments version metadata.

- [ ] **Step 5: Implement review states and approval**

Approved section records user/time/revision.

- [ ] **Step 6: Implement source-change invalidation**

If a fact used by an approved section changes, mark section `NEEDS_REVIEW` rather than silently changing content.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add markdown report authoring and review"
```

---

## Task 15: Implement AI Report Drafting, Polish, and Leak Review

**Files:**
- Create report AI prompts/actions.
- Create diff viewer component.
- Create visibility-filtered report context builder.
- Tests: public context cannot contain restricted text.

**Interfaces:**
- Produces: AI report drafts/proposals.

- [ ] **Step 1: Write a failing leak-prevention test**

Fixture contains the string `INTERNAL_SECRET_SENTINEL` in internal evidence.

Generate PUBLIC AI context.

Assert sentinel is absent.

- [ ] **Step 2: Implement visibility-filtered context builder**

Filter before provider invocation.

- [ ] **Step 3: Implement draft-section action**

AI produces Markdown plus source evidence IDs.

- [ ] **Step 4: Implement polish action**

Render original/proposed diff.

- [ ] **Step 5: Implement consistency review**

Check report claims against canonical finding/asset/version/score data.

- [ ] **Step 6: Implement AI leak review as advisory**

Deterministic visibility enforcement remains authoritative.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add AI-assisted report drafting and review"
```

---

## Task 16: Implement TLP, Report Linting, and PDF Exports

**Files:**
- Create: `packages/standards/src/tlp.ts`
- Create: `packages/reporting/src/lint.ts`
- Create: `packages/reporting/src/html.ts`
- Create: `packages/reporting/src/pdf.ts`
- Create: `apps/worker/src/jobs/report-pdf.ts`
- Create report CSS/templates.
- Tests: TLP, restricted evidence, PDF text/header.

**Interfaces:**
- Produces: reproducible approved PDF export.

- [ ] **Step 1: Implement TLP model**

Keep content visibility independent.

- [ ] **Step 2: Implement linter**

Implement checks in the Report Linter section.

- [ ] **Step 3: Implement Markdown → sanitized HTML**

No raw executable HTML.

- [ ] **Step 4: Implement Paged.js pagination**

Support page-aware report styling.

- [ ] **Step 5: Implement Playwright PDF worker**

No external network during rendering.

- [ ] **Step 6: Add PDF output validation test**

Extract generated PDF text and assert:

- title present.
- TLP label present.
- page footer present.
- prohibited sentinel absent from public report.

- [ ] **Step 7: Store export as immutable artifact**

- [ ] **Step 8: Commit**

```bash
git commit -am "feat: add secure TLP-aware PDF reporting"
```

---

## Task 17: Implement Disclosure Coordination

**Files:**
- Create disclosure DB schema/routes.
- Create disclosure UI.
- Add timeline directive renderer.
- Tests for embargo and timeline.

**Interfaces:**
- Produces: stakeholders, disclosure events, embargo data.

- [ ] **Step 1: Implement stakeholders/events/embargo schema**

- [ ] **Step 2: Build disclosure timeline UI**

- [ ] **Step 3: Build structured event creation**

- [ ] **Step 4: Insert disclosure timeline into report via directive**

- [ ] **Step 5: Add warnings for approaching planned disclosure**

Do not send notifications externally in V1 unless configured.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: add coordinated disclosure tracking"
```

---

## Task 18: Implement Search, Events, Dashboard, and Activity

**Files:**
- Create search module.
- Create event-stream module.
- Create dashboard route/components.
- Create activity route/components.
- Tests for query ranking/event invalidation.

**Interfaces:**
- Produces: global search, SSE, operational dashboard.

- [ ] **Step 1: Add FTS/trigram indexes**

- [ ] **Step 2: Implement global search endpoint**

Exact refs/hashes/CVEs rank first.

- [ ] **Step 3: Implement server-sent events**

Event types:

```text
entity.changed
job.progress
prior_art.completed
report.exported
intelligence.updated
```

- [ ] **Step 4: Connect events to TanStack Query invalidation**

- [ ] **Step 5: Build operational dashboard**

Use Needs Attention and What Changed sections.

- [ ] **Step 6: Virtualize activity/search lists**

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: add real-time search and research operations dashboard"
```

---

## Task 19: Packaging for macOS, Windows, and Fedora/Linux

**Files:**
- Modify: `apps/desktop/electron-builder.yml`
- Add platform build assets/config.
- Add release workflow.

**Interfaces:**
- Produces installable desktop builds.

Targets:

- macOS: DMG + ZIP, arm64 and x64.
- Windows: NSIS installer, x64.
- Linux: RPM for Fedora + AppImage, x64.
- ARM64 Linux may be added if CI hardware/build tooling is available.

- [ ] **Step 1: Configure electron-builder targets**

- [ ] **Step 2: Configure code signing hooks**

Support environment-provided macOS and Windows signing credentials; never commit credentials.

- [ ] **Step 3: Configure macOS notarization**

- [ ] **Step 4: Configure secure Electron fuses/ASAR**

- [ ] **Step 5: Add package smoke test**

Launch packaged application and verify login screen loads.

- [ ] **Step 6: Build on native CI runners**

Do not assume one OS can fully sign/package every target.

- [ ] **Step 7: Commit**

```bash
git commit -am "build: add cross-platform desktop packaging"
```

---

## Task 20: Production Security Review and Acceptance Gate

**Files:**
- Create: `docs/architecture/threat-model.md`
- Create: `docs/architecture/ai-security.md`
- Create: `docs/architecture/data-model.md`
- Add security-focused tests.

**Interfaces:**
- Produces: release acceptance checklist.

- [ ] **Step 1: Threat-model these trust boundaries**

At minimum:

```text
Renderer ↔ Preload
Preload ↔ Main Process
Desktop ↔ API
API ↔ PostgreSQL
API ↔ Object Storage
Worker ↔ Untrusted Artifacts
Desktop ↔ Claude Code
AI Provider ↔ Restricted Case Data
Report Generator ↔ Restricted Data
Public Export ↔ Visibility Boundary
```

- [ ] **Step 2: Add negative security tests**

Must cover:

- renderer cannot access Node.
- untrusted link cannot navigate primary window.
- invalid IPC sender rejected.
- public report cannot reference internal evidence.
- viewer cannot mutate.
- restricted case hidden from unauthorized member.
- expired session rejected.
- expired invite rejected.
- uploaded SVG/HTML is not executed.
- AI proposal cannot overwrite a newer target revision.
- AI cannot mark finding human-confirmed novel.
- report cannot export with blocking lint errors.

- [ ] **Step 3: Add dependency/security scanning**

Run package audit/advisory checks in CI and keep Electron current.

- [ ] **Step 4: Run complete validation**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

- [ ] **Step 5: Verify production infrastructure**

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm admin:create
```

Verify:

- admin login.
- invite member.
- create case.
- create software-component asset.
- create finding.
- upload screenshot.
- upload PoC.
- suggest CVSS.
- run prior-art check.
- run Claude report draft.
- approve vendor report.
- export TLP-marked PDF.
- confirm public report does not include internal evidence.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: complete CodeVault v1 security acceptance"
```

---

# 27. Critical End-to-End Acceptance Scenarios

## Scenario A: Small Finding

1. Member creates Standard case.
2. Creates `SOFTWARE_COMPONENT` asset.
3. Creates finding with title/summary.
4. Uploads screenshot.
5. AI drafts technical description.
6. Researcher edits and accepts.
7. AI suggests CWE/CVSS.
8. Researcher approves vector.
9. Prior-art check finds related CVE.
10. Researcher marks `POSSIBLE_MATCH`.
11. Internal report generated.
12. Case remains lightweight; no disclosure bureaucracy is forced.

## Scenario B: Embargoed Unauthenticated RCE

1. Member creates Critical Zero-Day case with explicit case members.
2. Creates primary asset and versions.
3. Creates finding.
4. Adds HTTP captures, screenshots, source files and PoC.
5. Peer reproduces and marks `PEER_REVIEWED`.
6. Prior-art check runs across internal/external sources.
7. AI comparison returns no obvious match.
8. Human sets `NO_PRIOR_ART_FOUND`, not automatic “zero-day.”
9. AI proposes CVSS 4.0 metrics with evidence citations.
10. Researcher approves.
11. Vendor disclosure report generated from VENDOR-allowed content.
12. Internal exploit notes remain INTERNAL.
13. Vendor contacted; timeline records event.
14. Vendor sends patch.
15. Patch verification evidence added.
16. Finding remediation becomes `FIX_VERIFIED`.
17. Public content is explicitly promoted to PUBLIC.
18. Public report generated using PUBLIC-only context.
19. Linter rejects accidental restricted evidence.
20. Reviewer approves.
21. TLP:CLEAR PDF exported.

## Scenario C: IoT / Firmware

1. Create `DEVICE`.
2. Create related `FIRMWARE`.
3. Add firmware versions and hardware model metadata.
4. Finding links to firmware and device.
5. Affected range records firmware-specific versions.
6. Evidence includes firmware image hash and PCAP.
7. Report accurately describes affected hardware/firmware relationship without requiring a WordPress/web-specific model.

## Scenario D: Government/Program Requirements

1. Create `PROGRAM` case.
2. Attach policy pack.
3. Policy pack requires CVSS 3.1, CVSS 4.0, two-person report approval and specific report sections.
4. Case readiness view shows which requirements are missing.
5. Export is blocked until required fields/reviews exist.
6. Core finding model remains unchanged.

---

# 28. Suggested Built-In Policy Packs

Implement these as code-defined defaults, editable later:

### Standard

- one reviewer optional.
- no disclosure fields required.
- internal report optional.

### Coordinated Disclosure

- vendor report required.
- disclosure contact required before `VENDOR_CONTACTED`.
- planned disclosure date optional.
- publication lint required.

### Critical Zero-Day

- restricted case recommended.
- peer review required before vendor report approval.
- full AI/context audit required.
- vendor and public report require distinct reviewer from last editor.
- public export blocked while visibility violations exist.

### Program

- configuration JSON controls required sections, score schemes, approvals, and export format.

Do not build a visual workflow designer for policy packs in V1.

---

# 29. Data Retention and Deletion Rules

Because research evidence may be sensitive:

- default behavior is archive, not hard delete.
- artifact delete requires confirmation and audit.
- deleting artifact metadata must also delete/revoke object storage data through a background job.
- report exports are immutable snapshots.
- approved report revisions are immutable.
- audit events are not deletable through normal APIs.
- disabled users remain referenced by historical records.
- case archive preserves data.
- case hard deletion is Admin-only and out of normal UI in V1.

---

# 30. Error Handling and UX Rules

Never show raw backend stack traces.

Use user-facing categories:

```text
Validation error
Permission denied
Conflict / data changed
Provider unavailable
AI output invalid
Background job failed
Upload failed
Export blocked
Server unavailable
```

For conflicts:

```text
This finding changed since the AI proposal was created.
Review the latest version before applying the proposal.
```

For AI unavailable:

```text
Claude Code was not detected on this workstation.
The finding can still be edited manually.
```

Do not make AI availability a requirement for core CRUD/report editing.

---

# 31. Telemetry and Privacy

V1 defaults to **no external product telemetry**.

Allowed internal logs:

- structured application logs.
- request IDs.
- job status.
- errors with sensitive-field redaction.

Never log:

- passwords.
- session tokens.
- raw PoCs.
- full report Markdown by default.
- uploaded file contents.
- AI prompts containing restricted content unless the explicit AI-run audit storage policy says to retain them.

Store AI input manifests as IDs/hashes by default; allow explicit policy to retain full prompts for audit if CodeVault chooses.

---

# 32. Implementation Quality Rules for Claude

Claude must follow these rules while implementing:

1. Use TDD for domain/security behavior.
2. Keep files focused; split files that become difficult to reason about.
3. Do not create giant generic utility files.
4. Do not use `any`.
5. Do not suppress TypeScript errors with `as unknown as`.
6. Validate every API boundary.
7. Validate every AI structured output.
8. Do not trust client-provided user/permission IDs.
9. Keep authorization checks server-side.
10. Do not silently weaken Electron sandbox settings to fix a dependency.
11. Do not add a dependency when a small local implementation is clearer.
12. Do not add a new infrastructure service without documenting why PostgreSQL/S3 cannot handle it.
13. Keep server data in TanStack Query rather than global React state.
14. Never introduce public signup.
15. Never introduce asset kinds tied to a single ecosystem unless they are identifier metadata, not top-level kinds.
16. Never let AI directly mark novel/known, approved, public, published, or fixed without a human action.
17. Every task ends with tests and a commit.
18. Before calling a task complete, run its focused tests plus `pnpm typecheck`.

---

# 33. Final Definition of Done

CodeVault V1 is complete only when a CodeVault researcher on macOS, Windows, or Fedora Linux can:

- install the desktop app.
- log into a shared CodeVault server.
- be invited without public registration.
- create a research case.
- create a standards-based asset without framework-specific taxonomy.
- model software, API, device and firmware targets.
- create a finding quickly.
- track affected versions.
- upload screenshots, files, captures, source, firmware and PoCs.
- see file hashes and metadata.
- create evidence/claims and references.
- run “Check Prior Art.”
- inspect all sources used by that check.
- ask Claude Code to analyze/draft using fixed safe actions.
- inspect the exact context sent to AI.
- accept/edit/reject AI proposals.
- propose and approve CVSS 4.0/3.1.
- associate CWE and external IDs.
- maintain disclosure state and timeline.
- generate Internal, Vendor and Public Markdown reports.
- ensure each report sees only its allowed data.
- review and approve sections.
- AI-polish reports through diffs.
- lint reports for leaks/inconsistencies.
- generate polished TLP-aware PDFs.
- search the complete research knowledge base.
- see a useful operational dashboard.
- inspect immutable activity/audit history.
- perform all normal research work without requiring AI to be online.
- never need to navigate generic enterprise-vulnerability-management bloat.

---

# 34. First Execution Command for Claude

After placing this plan in the repository, start implementation with:

```text
Read docs/superpowers/plans/2026-08-15-codevault-security-research-platform.md in full.

Implement it sequentially using subagent-driven development or executing-plans.
Do not skip security tests, visibility boundaries, report leak tests, or Electron sandbox requirements.
Before each task, inspect the interfaces produced by earlier tasks.
After each task, run the focused tests and TypeScript checks and commit the result.
Do not add features from the Non-Goals section without an explicit product decision.
```
