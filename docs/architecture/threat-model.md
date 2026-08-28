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
- **An insider or a mistaken colleague** who must not alter organization rules,
  identities, or research records beyond their assigned write authority.
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

MCP uses separate user-specific grants. The server stores only each grant's
SHA-256 digest. The local MCP process stores the raw grant and server URL in a
mode `0600` file. MCP grants have no idle timeout, so users can configure an AI
client once. Users can revoke each grant. Disabling the user or the
organization-wide MCP policy blocks the next request. An MCP grant never counts
as recent MFA and cannot create another grant. A password or role change revokes
all MCP grants for that user.

*Enforced by* `apps/server/src/auth/`, `apps/desktop/src/main/session-store.ts`.
*Tested by* `apps/server/src/auth.integration.test.ts`,
`apps/server/src/organization.integration.test.ts`, and
`packages/mcp/src/config.test.ts`.

Password verification does not create a session. It creates a five-minute,
hashed-at-rest challenge that must be completed with a replay-protected TOTP
counter. Challenges are source-bound and throttled; recovery grants only a
short-lived TOTP re-enrollment capability. Organization-wide mutations require
the `ADMIN` membership role, and sensitive changes require recent MFA.

TOTP is not phishing-resistant. A malicious site or endpoint process can relay
or capture a password and current code, and a compromised live API process can
use decrypted TOTP secrets. Passkeys/WebAuthn are the planned
phishing-resistant successor; sessions record the MFA method to support that
migration.

### 4. API ↔ PostgreSQL

All access is parameterised through Drizzle or `sql` template literals. Every
case requires ownership or an explicit read grant; organization membership
alone reveals no case existence. Write, approval, and disclosure are separate
case capabilities layered beneath the global role ceiling. Root list, search,
metric, evidence, report, notification, event, and activity queries use the
same user-aware readable-case scope.

Role authority lives on organization memberships. A deferred database
constraint prevents any committed transaction—including two racing admin
changes—from leaving the organization without an enabled administrator.

The audit table carries `DO INSTEAD NOTHING` rules for UPDATE and DELETE:
history cannot be rewritten through the application, including by a bug.

*Enforced by* `apps/server/src/services/case-access.ts`, `packages/db/drizzle/0001_initial_schema.sql`.
*Tested by* `apps/server/src/authorization.integration.test.ts`.

### 5. API ↔ Object storage

Buckets are private. The API issues short-lived presigned URLs and never
proxies bytes. Object keys are opaque and derived from identifiers we control —
never from the uploaded filename, which is attacker-supplied and would otherwise
reach path handling, log lines and bucket listings.

An upload cannot become downloadable unless the object exists, its size
matches, and a worker streams the entire object through SHA-256. Single-part
uploads also bind content length, type, and checksum into the signed request.
Mismatches are rejected and deleted.

*Enforced by* `apps/server/src/modules/evidence/routes.ts`, `packages/core/src/crypto.ts`.
*Tested by* `apps/server/src/evidence.integration.test.ts`.

### 6. Worker ↔ Untrusted artifacts

Decoding uploaded files happens in a dedicated non-root media container with a
read-only filesystem, no capabilities, bounded CPU/memory/PIDs/time, narrow
database functions, and prefix-limited object credentials. It independently
checks JPEG/PNG signatures, blocks every libvips loader before reopening only
the JPEG/PNG buffer loaders, caps pixels/edges/channels/pages, and publishes a
new metadata-free WebP raster. Raw avatars are never served and are deleted
after processing. Archives, binaries, firmware, PDFs, SVG, and other image
formats get metadata only.

SVG is deliberately excluded from image previews: it is a document format with
scripting, and "sanitise SVG" is a losing game.

*Enforced by* `apps/media-worker/`, `apps/worker/src/jobs/artifact-preview.ts`,
`packages/db/drizzle/0006_media_worker_least_privilege.sql`.

Native decoders can contain unknown vulnerabilities even when patched. The
container boundary limits blast radius but is not a proof of decoder safety.
The pinned decoder is a release gate, decoder failures are monitored, and its
credentials must never be reused by the API or general worker.

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
are entered into a dedicated sandboxed modal with no preload, Node, DevTools,
network, or application bridge and are never stored. PGP/MIME follows RFC 3156:
attachments and body are encrypted together, while the subject is visibly and
explicitly outside the encrypted entity. A stable RFC `Message-ID` is generated
before hashing so later Gmail reconciliation can prevent duplicate sends.

*Enforced by* `apps/desktop/src/main/crypto/`, `apps/desktop/src/main/submissions/`,
`apps/desktop/src/main/ipc.ts`, `apps/server/src/modules/submissions/`.
*Tested by* `apps/desktop/src/main/crypto/openpgp-message.test.ts`,
`apps/desktop/src/main/submissions/package-builder.test.ts`, and
`apps/desktop/src/main/security.test.ts`.

### 13. CodeVault ↔ Gmail

OAuth uses PKCE and a one-time expiring state. Refresh tokens are AES-256-GCM
encrypted with associated data binding them to provider, connection, and user;
key versions support rotation. Production provider endpoints are fixed HTTPS
Google origins. Test overrides are accepted only on exact loopback addresses
under `NODE_ENV=test`, which prevents DNS or configuration substitution from
exfiltrating a token.

The send worker enforces the connected Gmail identity against the sealed `From`
header and reconciles a stable RFC `Message-ID` around delivery. Timeouts are
ambiguous and never auto-retried. Reply sync queries metadata first and fetches
raw MIME only for a known provider thread. A stale history cursor recovers from
known thread IDs rather than searching the mailbox.

The interactive **Mail** page has a broader, user-driven read boundary. It
lists Inbox and Sent metadata. When the user opens a thread, the server fetches
raw MIME and returns plain text plus attachment metadata. If the organization
policy allows HTML, the server can also return allowlisted HTML structure. The
server removes scripts, forms, remote media, and CSS before the HTML crosses the
renderer boundary. A sandboxed `srcdoc` frame applies a second CSP that blocks
scripts, forms, frames, connections, and remote media. The server does not
store the preview. Tracking a thread requires a writable draft submission and
starts the durable, audited import flow.

*Enforced by* `apps/server/src/modules/mail/`,
`apps/worker/src/jobs/gmail-send.ts`, and `apps/worker/src/jobs/gmail-sync.ts`.
*Tested by* `tests/e2e/gmail-thread-sync.spec.ts` and the corresponding worker
unit tests.

### 14. Hostile inbound mail ↔ correspondence UI

Inbound MIME is size- and count-bounded. The server returns sanitized HTML only
when the organization policy allows it. Scripts, forms, remote tracking
resources, CSS, control characters, and path-bearing filenames are removed or
normalized. A policy change removes cached HTML from connected clients before
they refetch the thread. OpenPGP ciphertext is stored as opaque raw mail with no
server-side plaintext. Decryption happens locally after an unavoidable native
confirmation, and reviewed plaintext is an explicit audited append-only
revision.

Pub/Sub notifications are authenticated with Google's OIDC signature, issuer,
exact audience, and exact service-account email. Duplicate notifications are
idempotent. Case-derived notifications are filtered again at read time after a
grant change; reply notices may contain bounded sender and subject metadata but
never a message body or attachment bytes.

## Accepted risks

- **A researcher can still publish something they should not.** CodeVault
  blocks what it can prove is wrong and warns about the rest. Judgement stays
  with the person, by design.
- **The AI provider sees what policy allows.** If a workspace enables INTERNAL
  content for a local provider, that content reaches the provider. The control
  is the policy and the visible context, not an assumption about the model.
- **Revocation cannot retract bytes already displayed.** Server authorization,
  notification filtering, and targeted desktop cache eviction take effect at
  the next authorization boundary, but a recipient may already have copied or
  photographed material they were previously allowed to read.
- **Recovery depends on identity verification and offline custody.** A stolen
  unused recovery code can start MFA replacement, though it cannot directly
  create a research-data session. Administrators need an out-of-band process
  before initiating assisted recovery.
- **Endpoint compromise remains out of scope.** Malware on a researcher's
  workstation can capture displayed confidential data, passwords, TOTP codes,
  recovery codes, and an active session.
- **Prior-art coverage is bounded by the sources configured.** "No prior art
  found" means the checked sources returned no convincing match on a given date,
  which is what the interface says and what the badge's tooltip explains.
- **OpenPGP does not hide the email subject or transport metadata.** The UI
  labels the subject as unencrypted and confirmation makes recipients visible.
- **Gmail restricted scope is broader than background synchronization.** The
  worker does not fetch unrelated bodies. The **Mail** page can fetch a body
  only after the user opens its thread, and it does not persist the preview. A
  compromised server that holds a valid token could exercise Google's full
  granted scope. Use delivery-only mode where reply tracking is unnecessary.
- **A compromised workstation OS defeats local key and confirmation controls.**
  Private-key custody protects against renderer/server compromise, not an
  attacker controlling the researcher's operating system.

## Reporting a vulnerability in CodeVault

Use the process CodeVault exists to support: contact the maintainers privately,
allow time for a fix, and coordinate publication.
