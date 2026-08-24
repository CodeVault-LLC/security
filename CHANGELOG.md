# Changelog

This file records user-visible and operator-visible changes. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) for release identity,
with the prerelease sequence defined in [`ROADMAP.md`](ROADMAP.md).

## [Unreleased]

### Added

- Added a CWE 4.20 catalogue refresh with complete 2025 Top 25 coverage, rank
  metadata, canonical lookup, and bounded category queries.
- Added direct tests and reusable guards for CWE IDs, external identifiers,
  severity ratings, and TLP labels.
- Added reviewed folder intake for Markdown, JSON, CSV, captures, images, and
  attachments with mapping errors, duplicate warnings, original-file
  preservation, cancellation, and resumable upload state.
- Added generic JSON and CSV finding exchange plus the `codevault capture`
  command for files and standard input.
- Added the versioned `.cvcase` format, verified desktop export, staged artifact
  import, digest checks, and an all-or-nothing database commit for supported
  case records.
- Added MCP tools for listing and creating non-canonical intake drafts.

### Migrations

- Added `0018_case_archive_imports.sql` for expiring non-canonical archive
  import sessions and staged artifacts.

### Security

- Finding identifier requests now accept only supported schemes and canonical
  values. Invalid identifiers do not receive authority links.
- Identifier insertion, CVE state updates, and audit records now commit in one
  transaction. Retried inserts do not create duplicate audit events.
- Severity classification now rejects non-finite values and scores outside the
  CVSS range.

### Known gaps

- `.cvcase` version 1 does not move submissions, correspondence, disclosure
  events, prior-art history, PoC run history, or custom report templates.
- The three external-team adoption runs and the full historical-case end-to-end
  scenario remain release evidence work.

## [0.1.0-alpha.7] - 2026-08-21

### Added

- Added a disposable local evaluation command, fixed evaluator credentials,
  synthetic export-ready report, five-step in-product checklist, and evaluation
  and removal guides.
- Added pre-sign-in server compatibility checks, exact desktop and server
  versions, report contact settings, and organization report footers.
- Added organization-wide paginated report listing and case list filters.

### Changed

- Made partial evidence uploads recoverable with per-file retries, stable
  progress identities, and cleanup for unattached artifacts.
- Polls active prior-art jobs and blocks report approval and export while known
  blockers remain.
- Made the report workspace usable at accessibility zoom with compact
  navigation and an overflow action menu.

### Migrations

- Added `0017_organization_report_branding.sql` for report contact and footer
  fields.

### Compatibility

- Desktop Alpha 7 requires API `v1` and verifies compatibility before sign-in.
- Alpha packages remain test builds and may change before `0.1.0`.

## [0.1.0-alpha.6] - 2026-08-20

### Added

- Added the feature register with explicit implemented, partial, planned, and
  deferred states plus acceptance evidence for implemented features.
- Added a generated inventory of all 53 authenticated MCP tools and a CI drift
  check based on live MCP discovery.
- Added an exact desktop package inventory check for every operating system and
  architecture listed in the release policy.
- Added this changelog and the release-note template.

### Changed

- Reconciled the master implementation plan, AI expansion design, metrics
  design, MCP design, README, and security evidence index with current code.
- Documented the two line-scoped React Compiler exclusions required by TanStack
  Virtual. Lint now completes without compatibility warnings.
- Added the two existing end-to-end suites to ordinary CI and the tagged release
  gate.
- Updated every workspace package version to `0.1.0-alpha.6`.

### Security

- No security boundary changed. Documentation now distinguishes the in-product
  AI proposal pipeline from direct, authenticated MCP operations.
- Release inventory checks now reject missing architectures and unexpected
  desktop package types before publication.

### Migrations

- No database migration is required from `0.1.0-alpha.5`.

### Compatibility

- APIs, database behavior, and package formats remain alpha interfaces and may
  change before `0.1.0`.
- macOS and Windows alpha packages remain unsigned test builds.

### Known gaps

- Folder and external-agent intake, remaining MCP workflow tools, desktop TLP
  selection, and operational EPSS and KEV refresh are assigned to `alpha.7`.
- A real `v0.1.0-alpha.6` tag must still produce the cross-platform packages,
  OCI images, attestations, signatures, SBOMs, and VEX described by the release
  policy.

[Unreleased]: https://github.com/CodeVault-LLC/security/compare/v0.1.0-alpha.7...HEAD
[0.1.0-alpha.7]: https://github.com/CodeVault-LLC/security/compare/v0.1.0-alpha.6...v0.1.0-alpha.7
[0.1.0-alpha.6]: https://github.com/CodeVault-LLC/security/compare/v0.1.0-alpha.5...v0.1.0-alpha.6
