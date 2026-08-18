# CodeVault threat model

CodeVault holds the most sensitive artefacts a security researcher produces:
working exploits for unpatched software, evidence taken from systems they were
authorised to test, and embargo commitments made to vendors. A compromise here
is not a data breach in the ordinary sense — it is a disclosure, and disclosure
cannot be undone.

This document names the trust boundaries, states what is assumed about each,
and points at the code and the test that enforce it.

## What we are protecting

| Asset | Why it matters |
| --- | --- |
| Unpublished vulnerability detail | Publication before a fix exists harms users of the affected product |
| Proof-of-concept code | Directly weaponisable |
| Evidence and captures | May contain third-party data gathered under authorisation |
| Embargo dates and vendor correspondence | Breaking an embargo ends the coordination relationship |
| Session tokens | Grant the holder a researcher's full access |
| The audit trail | The record of who decided what, relied on in disputes |

## Who we are protecting against

- **A payload inside research content.** The single most likely attacker. A
  captured HTTP body, a filename, a firmware string or a Markdown block quoted
  from a target is rendered, indexed, sent to a model and printed into a PDF.
  It is assumed hostile everywhere.
- **A compromised or malicious dependency** in the renderer or the server.
- **An insider or a mistaken colleague** who should not see a particular case.
- **An attacker with the database**, through a backup or a stolen dump.
- **The AI provider**, treated as an untrusted external process that receives
  exactly what policy allows and nothing more.

Out of scope for V1: a compromised operating system on the researcher's own
workstation, and a malicious administrator who already controls the server.

## Trust boundaries

### 1. Renderer ↔ Preload

The renderer is treated as a document that may be executing an attacker's
script. It runs with `nodeIntegration: false`, `contextIsolation: true`,
`sandbox: true`, no `webviewTag`, and a Content Security Policy whose
`connect-src` is `'none'` — it cannot reach the network at all.

Its entire capability surface is the object in `apps/desktop/src/preload/index.ts`.
There is no generic `invoke`, no channel name, no `require`, and no filesystem
call. A payload that achieves script execution in the renderer can call the
same named operations a researcher can, and nothing else.

*Enforced by* `apps/desktop/src/main/security.ts`, `apps/desktop/src/preload/index.ts`.
*Tested by* `apps/desktop/src/main/security.test.ts`.

### 2. Preload ↔ Main process

Every IPC handler validates that the message came from the application's own
window before doing anything, because Electron delivers `invoke` calls from any
frame. Handlers never throw to the renderer; failures come back as a typed
outcome, so a rejected promise cannot carry main-process detail into a page.

The renderer may only address `/v1/` paths on the configured server. It cannot
choose a host, and it never sees the bearer token.

*Enforced by* `apps/desktop/src/main/ipc.ts`.

### 3. Desktop ↔ API

Opaque 32-byte session tokens, stored server-side as SHA-256 digests. No JWTs:
revocation has to take effect on the next request, and a stateless token cannot
be revoked. The raw token lives in the Electron main process, encrypted at rest
through `safeStorage`.

On Linux, when `safeStorage` degrades to its "basic text" backend — a hard-coded
key — CodeVault refuses to persist the session at all and says so. A session for
an embargoed case is not left in a file anyone can read.

Certificate errors are refused outright.

*Enforced by* `apps/server/src/auth/`, `apps/desktop/src/main/session-store.ts`.
*Tested by* `apps/server/src/auth.integration.test.ts`.

### 4. API ↔ PostgreSQL

All access is parameterised through Drizzle or `sql` template literals. Case
access is evaluated in SQL for list and search queries, so a restricted case
cannot leak through a filter that was applied in application code after the
rows were already fetched.

The audit table carries `DO INSTEAD NOTHING` rules for UPDATE and DELETE:
history cannot be rewritten through the application, including by a bug.

*Enforced by* `apps/server/src/services/case-access.ts`, `packages/db/drizzle/0001_initial_schema.sql`.
*Tested by* `apps/server/src/authorization.integration.test.ts`.

### 5. API ↔ Object storage

Buckets are private. The API issues short-lived presigned URLs and never
proxies bytes. Object keys are opaque and derived from identifiers we control —
never from the uploaded filename, which is attacker-supplied and would otherwise
reach path handling, log lines and bucket listings.

An upload cannot be marked complete unless the object exists and its size
matches what was declared; a mismatch quarantines the artifact.

*Enforced by* `apps/server/src/modules/evidence/routes.ts`, `packages/core/src/crypto.ts`.
*Tested by* `apps/server/src/evidence.integration.test.ts`.

### 6. Worker ↔ Untrusted artifacts

Decoding uploaded files happens in a separate process from the one answering
authenticated requests. Only formats with a bounded, safe representation get a
preview: images are re-encoded to a small WebP raster, which discards embedded
scripts and metadata; text is excerpted with a byte cap and control characters
stripped. Archives, binaries, firmware, PDFs and SVG get metadata only.

SVG is deliberately excluded from image previews: it is a document format with
scripting, and "sanitise SVG" is a losing game.

*Enforced by* `apps/worker/src/jobs/artifact-preview.ts`.

### 7. Desktop ↔ Claude Code

The provider is spawned with `shell: false`, always. The prompt contains text
captured from research targets; going through a shell would make quoting the
only thing between a captured HTTP body and command execution.

The prompt is written to stdin rather than passed as an argument, so it never
appears in the process list. The child starts from an empty environment and
receives only allow-listed variables, so it cannot read the workstation's other
credentials. It runs in a fresh temporary directory. A timeout and a
cancellation both terminate the process group.

*Enforced by* `apps/desktop/src/main/agents/claude-code.ts`.

### 8. AI provider ↔ Restricted case data

Two independent gates, both applied before a prompt exists:

1. **The audience rule.** A report action builds its context at the report's
   audience, so drafting a public advisory sees PUBLIC material only.
2. **The workspace policy.** A provider may be denied a visibility level
   entirely, or denied restricted cases outright.

Filtering is a data transformation, not a prompt instruction. Telling a model
"do not mention internal details" is not a security control; not sending them
is. The researcher can inspect the exact context — every item, its visibility,
its digest — before anything leaves the machine.

*Enforced by* `packages/ai/src/context.ts`, `apps/server/src/modules/ai/context-builder.ts`.
*Tested by* `packages/ai/src/context.test.ts`, `apps/server/src/ai-security.integration.test.ts`.

### 9. AI output ↔ Canonical data

Provider output must parse as JSON, validate against the action's schema, and
produce a patch touching only fields that action declared. A separate forbidden
list blocks a set of fields under every action: prior-art state, validation
state, disclosure state, visibility, approval and publication status.

Accepting a proposal asserts the target's revision, so a proposal prepared
against an older version cannot overwrite newer human work.

*Enforced by* `packages/ai/src/proposals.ts`, `apps/server/src/modules/ai/apply-proposal.ts`.
*Tested by* `packages/ai/src/proposals.test.ts`, `apps/server/src/ai-security.integration.test.ts`.

### 10. Report generator ↔ Restricted data

Report Markdown is untrusted. Raw HTML is dropped at the Markdown AST boundary
rather than sanitised afterwards, the output is allow-listed, and link protocols
are limited to `http`, `https` and `mailto`.

Directives resolve through the database and carry the real visibility of what
they point at. A directive the audience may not see is refused and rendered as a
visible error — never silently dropped, and never printing the identifier of the
internal record it referenced.

*Enforced by* `packages/reporting/src/markdown.ts`, `packages/reporting/src/directives.ts`.
*Tested by* `packages/reporting/src/markdown.test.ts`, `packages/reporting/src/directives.test.ts`.

### 11. Public export ↔ Visibility boundary

The linter runs before approval and again immediately before rendering, in the
worker. The second run is not redundant: content can change between the two, and
the export is the artifact that leaves the building.

`BLOCKING` findings stop the export. The PDF renderer runs with networking
disabled at the request level, so a report cannot fetch anything — including a
tracking pixel that would reveal an embargoed document had been opened.

*Enforced by* `packages/reporting/src/lint.ts`, `apps/worker/src/jobs/report-pdf.ts`.
*Tested by* `packages/reporting/src/lint.test.ts`, `apps/server/src/reports.integration.test.ts`.

### 12. Renderer ↔ disclosure sealing and OpenPGP keys

The renderer cannot read private keys, signed artifact URLs, package bytes, or
call the generic API path that completes a seal or sends a message. It can name
a submission through a fixed IPC operation. The main process downloads each
artifact, verifies its server-authenticated size and SHA-256, constructs the
MIME entity locally, and requires native confirmation before upload. The server
then independently reads object storage and verifies the final size and digest
before consuming a short-lived, one-time seal intent.

OpenPGP private keys remain in the main process. Persistent keys are encrypted
with Electron `safeStorage`; Linux `basic_text` storage is refused. Passphrases
are never stored. PGP/MIME follows RFC 3156: attachments and body are encrypted
together, while the subject is visibly and explicitly outside the encrypted
entity. A stable RFC `Message-ID` is generated before hashing so later Gmail
reconciliation can prevent duplicate sends.

*Enforced by* `apps/desktop/src/main/crypto/`, `apps/desktop/src/main/submissions/`,
`apps/desktop/src/main/ipc.ts`, `apps/server/src/modules/submissions/`.
*Tested by* `apps/desktop/src/main/crypto/openpgp-message.test.ts`,
`apps/desktop/src/main/submissions/package-builder.test.ts`, and
`apps/desktop/src/main/security.test.ts`.

## Accepted risks

- **A researcher can still publish something they should not.** CodeVault
  blocks what it can prove is wrong and warns about the rest. Judgement stays
  with the person, by design.
- **The AI provider sees what policy allows.** If a workspace enables INTERNAL
  content for a local provider, that content reaches the provider. The control
  is the policy and the visible context, not an assumption about the model.
- **A restricted case is invisible, not encrypted.** Someone with database
  access can read it. Per-case encryption is not in V1.
- **Prior-art coverage is bounded by the sources configured.** "No prior art
  found" means the checked sources returned no convincing match on a given date,
  which is what the interface says and what the badge's tooltip explains.

## Reporting a vulnerability in CodeVault

Use the process CodeVault exists to support: contact the maintainers privately,
allow time for a fix, and coordinate publication.
