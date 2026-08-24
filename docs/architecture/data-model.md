# Data model

CodeVault models security research, not a ticket queue. This document explains
the decisions that shape the schema and why the obvious alternatives were
rejected.

## Organization is the root

Exactly one organization may exist in a deployment. It owns memberships,
security policy, invitations, cases, assets, AI provider policy, reference
sequences, avatars, and audit events. Users do not carry global authority;
their `organization_memberships.role` is the source of truth.

Every enabled user has one membership and clearance to read the organization's
complete research corpus. `ADMIN`, `MEMBER`, and `VIEWER` control mutations,
and case ownership or explicit grants refine case writes. A deferred database
invariant guarantees at least one enabled administrator at transaction commit.

## Identifiers

Primary keys are UUIDv7: the timestamp prefix keeps inserts index-friendly
without exposing a sequence that would leak how much research exists.

Human-facing references are separate values, allocated from a `reference_sequences`
table inside the writing transaction so two concurrent creates cannot collide:

```
CASE-2026-0001    FIND-2026-0012    AST-000042
EVID-000123       POC-000007        REF-000019      RPT-000004
```

No internal reference imitates a CVE. `FIND-2026-0001` cannot be mistaken for an
assigned identifier in a screenshot or an email thread, and
`looksLikeCveIdentifier` guards against anything user-supplied that could be.

## Five states, not one status

A finding carries five independent state columns:

| Column | Answers |
| --- | --- |
| `validation_state` | Have we proved it? |
| `remediation_state` | Has it been fixed? |
| `disclosure_state` | Who has been told? |
| `external_id_state` | Does it have a CVE? |
| `prior_art_state` | Is it already known? |

The common real state of a finding is "confirmed, still unfixed, under embargo,
CVE reserved, prior art unchecked". A single status enum cannot express that, so
tools that use one end up with statuses like `CONFIRMED_EMBARGOED_CVE_PENDING`,
and then the same information is duplicated into free-text fields that drift.

Transitions are validated in `packages/core/src/states.ts`. `PUBLIC` disclosure
is terminal: once details are out, the platform will not pretend they can be
pulled back.

## Asset kinds are ecosystem-neutral

Twelve top-level kinds — `SOFTWARE_COMPONENT`, `APPLICATION`, `SERVICE`, `API`,
`DEVICE`, `FIRMWARE`, `HARDWARE`, `HOST_SYSTEM`, `CLOUD_RESOURCE`,
`NETWORK_SERVICE`, `REPOSITORY`, `CONTAINER_IMAGE` — and no more.

A WordPress plugin is a `SOFTWARE_COMPONENT` carrying
`pkg:wordpress/hummingbird-performance`. A network camera is a `DEVICE` with a
`FIRMWARE_FOR` relationship to a `FIRMWARE` asset, which `CONTAINS` the
components inside it.

The alternative — a kind per technology — produces a taxonomy that grows forever
and a matching engine that only works for whichever ecosystem was added first.
Ecosystem specificity belongs in `asset_identifiers` (a PURL, a CPE) and in
`metadata` (an architecture, a model number), where it is queryable without
being structural.

## Scores are records, not columns

One `finding_scores` table serves CVSS 4.0, CVSS 3.1, MITRE CWSS 1.0, OWASP
Risk Rating, SSVC, EPSS, KEV, EVSS and anything added later:

- **Calculable schemes** carry a vector. CodeVault computes the numeric score
  or categorical decision itself, which is why a client — human or model —
  cannot supply the result.
- **Intelligence schemes** carry a retrieved value with a named source and a
  retrieval timestamp. EPSS at 0.43 is a fact about a date; proprietary EVSS
  is retained only as a sourced Edgescan value because its formula is not open.

They are never multiplied together. A blended "CodeVault risk number" would
discard the one thing that makes these signals useful: that they measure
different things and disagree in informative ways.

A partial unique index allows one `APPROVED` score per scheme per finding;
approving a new one supersedes the old, which stays for the audit trail.

## Visibility and TLP are different things

`ContentVisibility` (`INTERNAL`, `VENDOR`, `PUBLIC`) answers *which projection of
this case may contain this item*. TLP answers *who may this be forwarded to*.

Collapsing them would mean a vendor report could not be marked
`TLP:AMBER+STRICT` without changing what data it may include. They are separate
columns and separate rules.

## Claims and provenance

A claim is an evidence-backed fact with a stable key:

```
vendor.fixed_version      "Vendor version 4.1.7 contains the patch."
auth.required             "This endpoint is reachable without authentication."
kev.listed                "CISA KEV includes CVE-2026-1234."
```

Each carries its source type (evidence, external, human, AI proposal), its
source reference, a confidence level, a visibility, and — for retrieved facts —
when it was fetched and when it goes stale. This is what lets a report
distinguish "we verified this" from "the vendor says this", which is the
distinction the report linter checks for.

## Evidence and artifacts

An artifact row is metadata around an object in storage: an opaque key, a
digest, a size, an uploader, a visibility. Bytes never enter PostgreSQL.

The original filename is stored as data and never used to build a path. A
`check` constraint requires the digest to be a SHA-256 hex string. Completion
moves the artifact to `VERIFYING`; only a streaming full-object digest match
moves it to `STORED`, which is the only downloadable state.

An evidence record groups artifacts and is only as shareable as the most
restricted thing attached to it — quoting an internal capture inside a
vendor-visible evidence record does not launder it.

## Reports are projections

A report belongs to a case and an audience, one each, enforced by a unique index.
It is composed of sections, each with its own review state, approval record and
list of `source_refs` — the identifiers of the records its content depends on.

When one of those records changes, the section is marked `NEEDS_REVIEW` rather
than being rewritten. Approval is of specific words; if the facts move, someone
has to read them again.

Every save writes an immutable revision, which is what makes an AI polish
reversible and an approval auditable.

## Vendor routes, submissions, and correspondence

A vendor is linked to assets by ID, never guessed from a product string. Each
EMAIL or MANUAL route stores validated requirements and provenance. Creating a
submission copies the complete route and its revision into an immutable
snapshot, so a later recipient, portal, key, or limit change cannot silently
alter an in-flight disclosure.

Submission text and attachments are mutable only before sealing. Every edit
writes a revision and invalidates approval. A sealed package records its
manifest digest, byte digest, size, cryptographic mode, and stable RFC
`Message-ID`; delivery records the exact mailbox, recipients, provider result,
and route snapshot. `DELIVERY_UNKNOWN` is a durable fact, not a retry state.

Correspondence rows belong to one submission and tracked provider thread. Raw
MIME and attachments use opaque object-storage keys; PostgreSQL holds bounded,
sanitised text and metadata. Lifecycle fields are human decisions layered over
immutable delivery and message facts. Closing or resolving requires an outcome
note, and snoozing requires both a bounded date and a reason.

## The audit table

Append-only, enforced by `DO INSTEAD NOTHING` rules on UPDATE and DELETE. Not a
convention, not application logic: a bug or a compromised API cannot rewrite
history.

Rows record the actor, session, request, action, entity, and the changed fields
only — never a full snapshot, and never a password, token or secret, which are
replaced with `[redacted]` on the way in.

## Search

Generated `tsvector` columns on cases, findings, assets, evidence and report
sections, with `pg_trgm` for typo-tolerant name matching. Exact identifiers,
references and digests are ranked above every text match, because a researcher
who typed a SHA-256 meant that file.

Organization access is applied in SQL as a subquery, not as a filter over
already-fetched rows. Restricted cases remain visible to all cleared members,
but records from a different organization cannot enter the result set.

`pgvector` is optional and off. Nothing requires an embedding service to work.
