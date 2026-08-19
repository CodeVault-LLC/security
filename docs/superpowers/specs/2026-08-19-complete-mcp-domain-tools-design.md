# Complete MCP Domain Tools Design

**Date:** 2026-08-19

**Status:** Approved direction; implementation pending

**Owner:** CodeVault Security

## Purpose

Expand `packages/mcp` from its current import-oriented tool set into a direct,
authenticated interface for the finding, evidence, case, disclosure, asset,
vendor, and report operations requested by the user.

The intended interaction is deliberately simple: when a user asks an AI client
to perform a supported CodeVault operation, the AI calls the corresponding MCP
tool and CodeVault performs the operation immediately under the authenticated
user's existing permissions. There is no second CodeVault approval screen,
single-use approval grant, agent-specific token, or extra confirmation protocol.

## Governing Decisions

1. **Direct execution.** MCP tools call the existing HTTP API as the authenticated
   user. Existing server-side authorization, validation, optimistic concurrency,
   audit behavior, and state-transition rules remain authoritative.
2. **All requested operations are exposed.** Approval and verification tools are
   included rather than withheld from MCP.
3. **No hidden workflow.** A tool result is the API result. The MCP does not create
   a parallel proposal queue or require a desktop hand-off.
4. **Explicit tool semantics.** Creation and approval remain separately named
   operations where the HTTP API separates them. `codevault_add_finding_score`
   also mirrors the HTTP endpoint's optional `approve` input, while
   `codevault_approve_finding_score` supports later approval of an existing score.
5. **The authenticated user owns the result.** The user has explicitly accepted
   that AI mistakes are their responsibility. Tool descriptions must still state
   material effects accurately so clients can choose the right operation.

This is an intentional change from the repository's current product rule that
AI may only propose certain conclusions. It applies to authenticated external
MCP clients and does not change the in-product AI proposal pipeline.

## Standards Context

No Class A--F classification is recorded for this project. This design does not
invent one; classification remains the engineering lead's decision under
CV-STD-0001.

The implementation must continue using the existing deterministic CVSS
calculators and CodeVault records rather than letting the MCP invent derived
numeric scores. The relevant authoritative provisions reviewed for this design
are CV-SEC-0100 sections 4.5, 5.10--5.14, 6.6--6.8, and requirements 8.3--8.5.
This MCP expansion does not claim to cure unrelated pre-existing conformance
gaps in the domain model.

## Tool Surface

The existing ten tools remain available. The following tools are added.

### Findings

| Tool | HTTP operation | Effect |
|---|---|---|
| `codevault_update_finding` | `PATCH /v1/findings/:id` | Updates any field accepted by `UpdateFindingRequest`, with `expectedRevision`. |
| `codevault_add_finding_score` | `POST /v1/findings/:id/scores` | Computes/records a score; may approve it when `approve` is explicitly supplied. |
| `codevault_approve_finding_score` | `POST /v1/findings/:id/scores/:scoreId/approve` | Approves an existing score immediately. |
| `codevault_add_finding_identifier` | `POST /v1/findings/:id/identifiers` | Adds a CVE, GHSA, OSV, vendor, tracker, or custom identifier. |
| `codevault_add_finding_claim` | `POST /v1/findings/:id/claims` | Adds a structured claim. |
| `codevault_add_finding_reference` | `POST /v1/findings/:id/references` | Adds an external reference. |

The existing `codevault_get_finding` supplies score IDs, claims, references,
identifiers, and revisions required by these tools.

### Evidence and artifacts

| Tool | HTTP operation | Effect |
|---|---|---|
| `codevault_list_evidence` | `GET /v1/evidence` | Lists evidence, filterable by case, finding, visibility, and query. |
| `codevault_create_evidence` | `POST /v1/evidence` | Creates evidence and attaches existing artifact IDs. |
| `codevault_update_evidence` | `PATCH /v1/evidence/:id` | Updates evidence metadata, finding association, visibility, or artifact links. |
| `codevault_upload_evidence_file` | upload start, object-storage PUT(s), upload completion, then evidence create/update | Reads a named local file, hashes it, uploads it through CodeVault's presigned flow, and optionally creates or updates the evidence record that attaches it. |
| `codevault_get_artifact_download` | `GET /v1/artifacts/:id` | Returns the short-lived download URL and integrity metadata for a stored artifact. |

`codevault_upload_evidence_file` accepts a local path because the MCP server runs
on the user's workstation. It follows redirects only through the fetch runtime,
sends only the server-provided required headers, supports single-part and
multipart upload instructions, and completes the upload before attaching the
artifact. It does not execute or parse the uploaded file.

### Cases and disclosure

| Tool | HTTP operation | Effect |
|---|---|---|
| `codevault_get_case` | `GET /v1/cases/:id` | Reads case detail. |
| `codevault_update_case` | `PATCH /v1/cases/:id` | Updates fields accepted by `UpdateCaseRequest`. |
| `codevault_list_case_notes` | `GET /v1/cases/:id/notes` | Lists case notes. |
| `codevault_add_case_note` | `POST /v1/cases/:id/notes` | Adds a case note. |
| `codevault_get_case_readiness` | `GET /v1/cases/:id/readiness` | Evaluates policy-pack readiness. |
| `codevault_get_case_disclosure` | `GET /v1/cases/:id/disclosure` | Reads stakeholders, events, embargo, and warnings. |
| `codevault_add_case_stakeholder` | `POST /v1/cases/:id/stakeholders` | Adds a disclosure stakeholder. |
| `codevault_add_disclosure_event` | `POST /v1/cases/:id/disclosure-events` | Records a disclosure event. |
| `codevault_set_case_embargo` | `POST /v1/cases/:id/embargo` | Creates or updates embargo dates and agreement notes. |

Disclosure events remain append-only because the existing API has no event
update or deletion endpoint.

### Assets

| Tool | HTTP operation | Effect |
|---|---|---|
| `codevault_get_asset` | `GET /v1/assets/:id` | Reads complete asset detail. |
| `codevault_update_asset` | `PATCH /v1/assets/:id` | Updates asset fields with optimistic concurrency. |
| `codevault_add_asset_identifier` | `POST /v1/assets/:id/identifiers` | Adds or promotes an asset identifier. |
| `codevault_add_asset_version` | `POST /v1/assets/:id/versions` | Adds a version record. |
| `codevault_add_asset_relationship` | `POST /v1/assets/:id/relationships` | Adds a directed asset relationship. |

### Vendors, contact routes, and public keys

| Tool | HTTP operation | Effect |
|---|---|---|
| `codevault_get_vendor` | `GET /v1/vendors/:id` | Reads vendor detail, routes, and public keys. |
| `codevault_update_vendor` | `PATCH /v1/vendors/:id` | Updates vendor metadata. |
| `codevault_add_vendor_contact_route` | `POST /v1/vendors/:vendorId/routes` | Adds an email or manual disclosure route. |
| `codevault_get_vendor_contact_route` | `GET /v1/vendor-routes/:id` | Reads one route. |
| `codevault_update_vendor_contact_route` | `PATCH /v1/vendor-routes/:id` | Updates or disables a route. |
| `codevault_add_vendor_public_key` | `POST /v1/vendors/:vendorId/public-keys` | Parses and stores a public-key version. |
| `codevault_verify_vendor_public_key` | `POST /v1/vendors/:vendorId/public-keys/:keyId/verify` | Verifies the recorded fingerprint immediately. |

The route schemas preserve the existing discriminated email/manual shapes. The
MCP performs no cryptographic verification itself; CodeVault's server remains
the authority.

### Reports

| Tool | HTTP operation | Effect |
|---|---|---|
| `codevault_list_report_templates` | `GET /v1/report-templates` | Lists built-in report templates. |
| `codevault_list_reports` | `GET /v1/reports?caseId=...` | Lists reports for a case. |
| `codevault_create_report` | `POST /v1/reports` | Creates an audience-specific report. |
| `codevault_get_report` | `GET /v1/reports/:id` | Reads report and section detail. |
| `codevault_update_report` | `PATCH /v1/reports/:id` | Updates report metadata. |
| `codevault_update_report_section` | `PATCH /v1/reports/:id/sections/:sectionId` | Writes content or changes section review state. |
| `codevault_lint_report` | `GET /v1/reports/:id/lint` | Returns structured lint findings. |
| `codevault_preview_report` | `GET /v1/reports/:id/preview` | Returns rendered HTML plus lint results. |
| `codevault_approve_report` | `POST /v1/reports/:id/approve` | Approves a report immediately if server requirements pass. |
| `codevault_list_report_exports` | `GET /v1/reports/:id/exports` | Lists queued and completed exports. |
| `codevault_export_report` | `POST /v1/reports/:id/exports` | Queues PDF or Markdown export. |

## Architecture

### MCP registration

`server.ts` remains the composition root. Domain registrations move into focused
modules under `packages/mcp/src/tools/` so the expanded tool set does not turn a
single file into an unreviewable registry. Shared Zod schemas and the common
JSON/error result wrapper live in `tools/shared.ts`.

Each domain module exports one registration function:

- `registerFindingTools`
- `registerEvidenceTools`
- `registerCaseTools`
- `registerAssetTools`
- `registerVendorTools`
- `registerReportTools`

### HTTP client

`CodeVaultClient` gains one typed method per HTTP operation. A small generic
request seam remains private for authenticated CodeVault calls. Artifact upload
adds an explicit unauthenticated presigned-request helper that sends no
CodeVault bearer token to object storage.

The client will continue URL-encoding every path identifier and building query
strings from defined values only.

### Schema ownership

MCP input schemas are Zod equivalents of the TypeBox contracts. Domain enums are
imported from `@codevault/core` or `@codevault/standards` rather than duplicated
as free text. Inputs omit `undefined` before transmission and retain explicit
`null` values where the API uses null to clear a field.

### Error handling

Every tool uses the existing safe result envelope. API errors include bounded
status, message, and request ID without exposing credentials. Local file and
object-storage failures identify the failed phase without printing bearer
tokens, presigned query strings, or file contents.

The score-approval implementation will also correct the existing integrity bug
by requiring `scoreId` to belong to `findingId` before approval.

## Tool Annotations and Instructions

- Pure reads use `readOnlyHint: true`.
- Creates and additive records use `readOnlyHint: false` and
  `destructiveHint: false`.
- Approval, verification, lifecycle-changing updates, report-section review
  changes, and embargo changes use `destructiveHint: true` to describe their
  material effect. These annotations are client hints, not confirmation gates.
- Server instructions state that all tools execute immediately and that the AI
  must use current revisions returned by get/list tools.

## Testing

Development follows test-driven cycles.

1. **Inventory tests** assert the complete exact tool-name set and annotations.
2. **Client mapping tests** assert method, encoded URL, query, and JSON body for
   every endpoint family.
3. **Score tests** prove creation can remain proposed, inline approval is
   transmitted when requested, separate approval works, and a score belonging
   to another finding is rejected.
4. **Upload tests** cover hashing, single-part upload, multipart upload,
   completion, attachment, header isolation, and bounded error messages.
5. **Schema tests** exercise representative email/manual routes, nullable
   updates, report sections, disclosure events, claims, and identifiers.
6. **Regression checks** run MCP tests, server integration tests relevant to
   findings/reports/evidence/vendors, MCP typecheck, repository typecheck, lint,
   and formatting checks.

## Documentation

`docs/operations/mcp.md` will list the expanded capabilities, direct-execution
semantics, examples, file-upload behavior, and the fact that approval and
verification tools act immediately under the authenticated user.

The previous statement that MCP does not expose approval, disclosure, or score
approval will be removed because it will no longer be true.

## Out of Scope

- A new agent-token or capability-token subsystem.
- A separate approval UI, confirmation grant, or MCP elicitation flow.
- New domain endpoints that do not already exist, such as editing case notes or
  disclosure events.
- Publication or deletion tools not requested by the user.
- Reworking the in-product AI proposal/Accept/Edit/Reject pipeline.
- Broad remediation of pre-existing standards gaps unrelated to exposing the
  requested API operations.

## Acceptance Criteria

1. Every tool named in this design appears in MCP discovery with a validated
   input schema and accurate annotation.
2. Each tool calls the corresponding existing HTTP operation and returns its
   structured JSON result.
3. Approval and verification tools execute directly without a second workflow.
4. Score creation supports both proposed and explicitly inline-approved records.
5. Local evidence files can be uploaded and attached without leaking the
   CodeVault bearer token to object storage.
6. Existing MCP tools remain backward compatible.
7. Documentation matches the actual surface.
8. The focused and repository verification suites pass.
