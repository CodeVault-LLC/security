# CodeVault Security roadmap

Status: Active

Last reviewed: 2026-08-20

Current version: `0.1.0-alpha.6`

This roadmap turns the current repository into a release sequence. It covers product work, operational work, and the evidence required to publish each release. A milestone is complete only when its exit criteria pass. Moving unfinished work to a later milestone requires an explicit roadmap change.

## Current position

The project has more working software than its version suggests. The repository contains the desktop client, API, background workers, isolated media worker, PostgreSQL schema, object storage, release automation, and these product areas:

- Cases, case membership, assets, findings, affected ranges, identifiers, claims, evidence, artifacts, and PoC records.
- CVSS 4.0 and 3.1, CWE, report-level TLP, internal prior-art search, NVD, OSV, and GitHub advisory search. EPSS and KEV have a data model and worker handler, but no production trigger or complete refresh behavior.
- Internal, vendor, and public reports with section review, visibility filtering, linting, directives, PDF export, and publication-readiness checks.
- Vendors, disclosure routes, submissions, manual delivery, Gmail delivery and synchronization, OpenPGP packaging, correspondence, embargoes, and disclosure events.
- Local Claude Code and Codex CLI providers with reviewed action schemas, filtered context, proposals, and organization policy.
- TOTP MFA, recovery and re-enrollment, invitations, role controls, audit events, quarantined avatar processing, and organization settings.
- Dashboard, search, activity, metrics, charts, development seed data, self-hosted deployment files, desktop packaging, OCI images, SBOMs, VEX, signatures, and attestations.
- An authenticated MCP interface for many case, asset, finding, evidence, report, and vendor operations.

The local baseline passed on 2026-08-20:

- ESLint completed with no errors and two known React Compiler compatibility warnings around TanStack Virtual.
- Prettier passed.
- All 13 workspaces passed type checking.
- All 76 unit and DOM test files passed, for 750 tests total.

That baseline does not prove release readiness. Database integration tests, the two end-to-end suites, native packages, OCI images, and a real tagged release were not run as part of this roadmap review.

## What is missing or needs work

### Product completeness

1. Finish intake automation. Manual intake exists, but the planned folder import and external-agent intake flows are not complete.
2. Finish the MCP domain. The current implementation covers much of the model, but disclosure operations and some workflow actions still lack first-class tools. Reconcile the implementation with `docs/superpowers/specs/2026-08-19-complete-mcp-domain-tools-design.md` and publish a generated tool inventory.
3. Make the full research path recoverable. Draft persistence exists in report and finding work, but every create, upload, AI, export, submission, and synchronization flow needs interruption and retry coverage.
4. Add bulk work where volume makes single-record actions impractical. The first candidates are intake decisions, finding ownership and state changes, evidence classification, and vendor-route review.
5. Add import and export boundaries. Define a stable case archive that includes structured records, report revisions, evidence manifests, and digests without silently exporting restricted bytes.
6. Add notification policy and delivery. The dashboard shows due work, but users need durable in-product notifications for invitations, MFA resets, failed jobs, vendor replies, approaching disclosure dates, and stale prior-art or intelligence checks.
7. Complete accessibility verification. Keyboard access and semantic controls are design requirements, but the repository lacks a complete keyboard walkthrough, screen-reader review, contrast evidence, zoom coverage, and automated accessibility checks for critical screens.
8. Define supported scale. Measure large cases, long reports, large evidence sets, search volume, correspondence threads, and worker backlogs. Set limits and show useful errors when a limit is reached.
9. Finish TLP controls. Reports store and validate TLP labels, exports print them, and MCP can update them. Add a permitted desktop control for selecting an audience-compatible label and cover that flow with an acceptance test.
10. Make EPSS and KEV refresh operational. Enqueue refreshes when a finding gains or changes a CVE, add scheduled staleness refresh, expose manual refresh and status, record both positive and negative KEV results, clear superseded values, surface provider failures, and add worker and end-to-end tests.

### Reliability and operations

1. Add backup and restore commands, retention guidance, and a restore rehearsal. Production Compose is hardened, but a stable release needs a proven recovery path for PostgreSQL and object storage as one consistent dataset.
2. Define upgrades and rollbacks. Test every migration from the previous supported release, document irreversible migrations, and block startup when an unsafe version skew exists between the server and workers.
3. Add operational health and telemetry. Expose health, readiness, queue depth, job age, failure counts, storage reachability, database pool pressure, mail-watch expiry, and build version without leaking case data.
4. Add job recovery controls. Operators need bounded retries, dead-letter inspection, safe replay, cancellation where possible, and idempotency evidence for every externally consequential job.
5. Test resource exhaustion and partial failure. Cover full disks, unavailable object storage, database failover, interrupted uploads, malformed provider responses, Gmail quota failures, expired OAuth grants, and media-worker crashes.
6. Ship a verified desktop update system before `beta.1`. The default Stable channel receives only stable releases. Users may opt into Beta or Alpha, and they may return to a less experimental channel. Beta receives beta, release-candidate, and stable releases. Alpha receives every prerelease and stable release. A channel change must never silently downgrade the installed application or database.
7. Show the application version and selected update channel on the sign-in screen and in **Settings > Updates**. Let the user copy the version, channel, platform, architecture, and server compatibility details for a support report.
8. Publish signed update metadata and release notes from the protected release workflow. The desktop application must verify the update source, version, digest, and native signature before offering installation. An update feed must never bypass the artifact checks in `docs/security/release-verification.md`.
9. Make update behavior explicit and recoverable. Support automatic checks, **Check for updates**, download progress, **Install and restart**, **Remind me later**, download or verification failure, insufficient disk space, unsupported platform, offline, no-update, and restart-required states. Never interrupt active edits, uploads, AI runs, report exports, or submission delivery.
10. Publish platform support. Name tested operating-system versions, CPU architectures, PostgreSQL and S3-compatible services, Gmail prerequisites, and minimum workstation resources.

### Security and assurance

1. Apply the external GitHub settings in `docs/security/repository-settings.md`: account MFA, branch and tag rulesets, required checks, the protected `release` environment, secret scanning, push protection, and code scanning.
2. Run the full ASVS 5.0.0 Level 3 assessment. The current register marks the requirements as gaps pending verification.
3. Commission an independent security assessment before the stable release. Resolve critical and high findings. Record accepted lower-severity risk with an owner and review date.
4. Exercise security response. Run a private vulnerability-report drill, an artifact-withdrawal drill, a signing-credential rotation drill, and a mail-token and MFA-key rotation drill.
5. Verify a real release. Check the generated SBOMs, VEX, checksums, attestations, OCI signatures, native signatures, and SLSA claim against published artifacts.
6. Add data lifecycle controls. Define retention, secure deletion, legal hold, export, and administrator-visible deletion status for database rows, object-store data, quarantined uploads, logs, and backups.
7. Produce a privacy and data-flow review for local AI tools, Gmail, NVD, OSV, GitHub Advisories, and any future provider. The UI must state which data leaves the deployment before a user enables an integration.

### Test and engineering quality

1. Expand end-to-end coverage beyond the two vendor and Gmail scenarios. Cover login and recovery, invitations, case creation, finding and evidence work, report approval and export, restricted-case access, AI proposal review, and failed-job recovery.
2. Add migration tests from released database snapshots, not only a clean database.
3. Add API contract compatibility tests between the desktop client, server, worker, media worker, and MCP client.
4. Add performance and memory budgets for the desktop renderer, search, report rendering, large uploads, and background queues.
5. Resolve or deliberately suppress the two React Compiler warnings with a linked explanation and a regression check.
6. Remove stale plan status. The metrics and MCP design documents still describe implemented work as pending. Keep one feature register that links a requirement to code, tests, documentation, and its release.
7. Add changelog automation and release-note checks. Every user-visible or operator-visible change needs a migration note, security impact, and compatibility statement when applicable.

## Versioning rules

Continue the current line as `0.1.0-alpha.N`. Do not publish `0.1.1-alpha.1` before `0.1.0`, because SemVer treats it as development toward a version after `0.1.0`. Use this order:

```text
0.1.0-alpha.5
0.1.0-alpha.6  current, then through alpha.9
0.1.0-beta.1   through beta.2
0.1.0-rc.1
0.1.0           first supported release
0.1.1-alpha.1   first maintenance preview after 0.1.0
0.1.1           first maintenance release
```

An alpha may change the schema, API, workflows, and package format. A beta freezes the intended `0.1.0` feature set and supported deployment shape. An RC accepts only release-blocking fixes, documentation corrections, and evidence work. Stable releases follow the support and withdrawal rules in `docs/security/release-policy.md`.

## Release sequence

### `0.1.0-alpha.6`: Make the repository tell the truth

Goal: establish one reliable inventory and a reproducible baseline.

- Reconcile the master plan, AI expansion, metrics design, MCP design, README, and security evidence index with the code.
- Add a feature register with `implemented`, `partial`, `planned`, and `deferred` states. Link each implemented feature to at least one acceptance test.
- Generate and document the MCP tool inventory.
- Fix or document the React Compiler compatibility warnings.
- Run all unit, DOM, database integration, and existing end-to-end tests in CI.
- Produce native desktop packages and all three OCI images from a clean tag candidate.
- Add `CHANGELOG.md` and a release-note template.

Exit criteria: the clean-checkout build works, every current CI gate passes, package inventory matches the release policy, and no document labels shipped work as pending.

### `0.1.0-alpha.7`: Complete the core research loop

Goal: make a researcher able to take a case from intake to an approved report without a manual database repair.

- Complete folder intake and external-agent intake with preview, deduplication, accept, merge, reject, cancellation, and audit history.
- Complete missing MCP case, disclosure, evidence, report, and workflow operations from the approved design.
- Add a versioned case export and a verified import or restore path.
- Add bulk intake review and the smallest set of bulk finding and evidence actions proven necessary by realistic datasets.
- Make local drafts and retry behavior consistent across create, edit, upload, AI, and export flows.
- Add the desktop TLP control and complete the EPSS and KEV refresh path, including triggers, staleness, negative KEV results, failure visibility, and tests.
- Add end-to-end scenarios for case creation, finding assessment, evidence upload, AI proposal review, report approval, and PDF export.

Exit criteria: a seeded case can complete the core research loop through both the desktop client and supported MCP operations, with audit records and no direct database edits.

### `0.1.0-alpha.8`: Complete coordinated disclosure

Goal: make vendor coordination safe under interruption and provider failure.

- Add durable in-product notifications and an operator-visible failed-job view.
- Finish Gmail connection lifecycle, watch renewal, token revocation, quota handling, reply correlation, attachment handling, and safe replay tests.
- Test manual, plaintext Gmail, encrypted Gmail, signed and encrypted Gmail, and inbound encrypted-reply workflows.
- Add route expiry, stale-key, missed-follow-up, and disclosure-deadline warnings.
- Add end-to-end tests for approval, sealing, delivery idempotency, correspondence sync, retry, and withdrawal before delivery.
- Document provider data flows and consent at configuration time.

Exit criteria: no network retry can send a submission twice, every external action has a human approval record, and failed delivery or sync work is visible and recoverable.

### `0.1.0-alpha.9`: Prove operability and scale

Goal: make a self-hosted installation recoverable and measurable.

- Add consistent backup and restore tooling for PostgreSQL and object storage.
- Rehearse restore into an empty deployment and compare record counts and artifact digests.
- Test upgrades from `alpha.6`, `alpha.7`, and `alpha.8` snapshots. Document rollback limits.
- Add health, readiness, queue, storage, database, mail-watch, and build-version telemetry.
- Add dead-letter inspection and safe job replay.
- Publish supported platform and resource requirements.
- Set and test scale budgets for cases, findings, evidence, report size, search, and queue latency.
- Add a protected update feed for signed macOS, Windows, and supported Linux artifacts. Publish channel-specific metadata for Stable, Beta, and Alpha.
- Add the update client, automatic checks, manual checks, download progress, release-note display, verified installation, restart handling, and failure recovery.
- Add an update-channel control with three visible choices. Default new installations to Stable. Warn before Alpha or Beta opt-in and explain which versions each channel receives.
- Show the exact application version and channel on the sign-in screen and in **Settings > Updates**. Add a copyable diagnostics summary.
- Add desktop and release-workflow tests for channel promotion, SemVer ordering, feed authenticity, digest mismatch, signature failure, interrupted downloads, rollback refusal, active-work deferral, and server compatibility.
- Document platform-specific behavior. If an installed package cannot update itself safely, detect that package and give the user a verified download action instead of reporting that automatic updates are available.

Exit criteria: an operator can install, observe, back up, restore, upgrade, and diagnose the product using documented commands. A user on each update channel can discover, verify, install, defer, and recover from an update without losing work.

### `0.1.0-beta.1`: Feature complete

Goal: freeze everything intended for `0.1.0`.

- Close or defer every product-completeness item in this roadmap.
- Block beta publication unless updates from the latest alpha to `beta.1` pass on every supported desktop installation type.
- Freeze public API contracts, the database migration path, artifact names, configuration names, and the supported deployment shape.
- Complete keyboard-only, screen-reader, 200 percent zoom, reduced-motion, and contrast reviews for critical workflows.
- Add end-to-end coverage for authentication, recovery, invitations, restricted cases, all core research work, report export, vendor delivery, and recovery from failed jobs.
- Publish administrator, operator, researcher, integration, backup, restore, upgrade, and troubleshooting documentation.
- Start a beta feedback register. Give every accepted blocker an owner and target release.

Exit criteria: no planned `0.1.0` feature is missing, no known data-loss path is open, and all supported workflows have acceptance evidence.

### `0.1.0-beta.2`: Security and compatibility complete

Goal: remove release blockers without adding product scope.

- Complete the ASVS 5.0.0 Level 3 self-assessment and record evidence per applicable requirement.
- Complete an independent security assessment. Fix all critical and high findings.
- Run failure, load, migration, backup, restore, and long-running worker tests.
- Apply and record the required GitHub organization, repository, tag, environment, and security settings.
- Obtain and test Apple and Windows signing credentials.
- Run vulnerability-report, release-withdrawal, credential-rotation, and disaster-recovery exercises.
- Triage all beta feedback. Fix blockers and record deferred work.

Exit criteria: the security reviewer, product owner, and release owner sign the beta exit record. No critical or high vulnerability remains open.

### `0.1.0-rc.1`: Rehearse the exact release

Goal: produce the artifact set that can become `0.1.0` without code changes.

- Freeze dependencies and the source commit.
- Run the complete release workflow from the protected environment.
- Install and smoke-test every desktop package on its declared operating systems.
- Deploy every OCI image by digest into a clean production-shaped environment.
- Verify migrations from the latest beta and restore a beta backup after the upgrade rehearsal.
- Verify checksums, SBOMs, VEX, scans, attestations, signatures, notarization, source archive, release notes, and upgrade instructions as a consumer would.
- Allow only release-blocking corrections. Any code change creates `rc.2` and repeats the full rehearsal.

Exit criteria: the release candidate meets every stable-release requirement below and completes a soak period with no release blocker.

### `0.1.0`: First supported release

Publish `0.1.0` only when the release owner records evidence for every requirement in the next section. Tag the exact approved RC commit. Do not rebuild from a different source revision.

### `0.1.1-alpha.1`: First maintenance preview

Start this line only after `0.1.0` exists.

- Accept security fixes, data-loss fixes, compatibility fixes, accessibility fixes, and small usability corrections.
- Do not add a new major workflow or incompatible schema change.
- Add a regression test for every fixed defect.
- Test upgrade and rollback behavior against `0.1.0`.

Promote through `0.1.1-beta.1`, `0.1.1-rc.1`, and `0.1.1` when the change risk warrants those stages. A narrow urgent security fix may use an abbreviated schedule, but it must still pass the stable release gates.

## Stable release requirements

The following list is the release gate for `0.1.0` and later stable versions.

### Product

- The release scope and deferred work are written in the changelog.
- Every supported workflow has an acceptance test and user documentation.
- No critical workflow depends on an optional AI provider.
- External communication and publication always require a permitted human action.
- Restricted case existence and content remain hidden from unauthorized users.
- Import, export, backup, restore, upgrade, and failure recovery paths have passed against release artifacts.
- The application displays its exact version and selected update channel before and after sign-in.
- Stable, Beta, and Alpha channel selection works as documented. Stable is the default.
- Update checks, release notes, download, verification, deferral, installation, restart, and recovery have passed on every supported desktop installation type.
- The updater preserves active work, rejects untrusted or older artifacts, and gives users a verified manual path when self-update is unavailable.
- Accessibility acceptance covers keyboard use, focus, names, contrast, zoom, reduced motion, and non-color meaning.

### Quality

- Frozen install, lint, formatting, type checking, unit tests, DOM tests, database integration tests, end-to-end tests, and all builds pass from a clean checkout.
- Migration tests pass from every supported prior release.
- Update tests pass from every supported prior desktop version and prerelease channel.
- Performance and resource tests meet the published budgets.
- Every release-blocking bug is closed. Deferred bugs have severity, impact, workaround, owner, and target release.
- The exact release commit has no uncommitted files and its tag matches `package.json`.

### Security

- Dependency audit, CodeQL, dependency review, secret scan, configuration scan, workflow scan, media-decoder checks, and final OCI scans pass.
- No known critical or high vulnerability remains open in shipped code or images.
- The threat model and security evidence index match the release architecture.
- The ASVS assessment and independent security review are complete for the release scope.
- Signing, MFA, mail-token, and vulnerability-response exercises have current evidence.
- GitHub branch, tag, environment, access, and security settings match `docs/security/repository-settings.md`.

### Operations

- A clean install, backup, restore, upgrade, rollback rehearsal, and disaster-recovery exercise pass.
- Health and readiness checks detect unavailable required dependencies.
- Operators can inspect and recover failed background work without direct database edits.
- Supported platforms, dependencies, capacity limits, data retention, and support policy are published.
- Monitoring and log guidance avoids secrets, tokens, credentials, restricted case titles, and evidence content.

### Distribution and evidence

- Every artifact listed in `docs/security/release-policy.md` exists.
- The protected release workflow publishes authenticated update metadata and release notes for each applicable channel.
- macOS artifacts are signed and notarized. Windows artifacts are signed. OCI images are published by immutable digest and signed.
- Checksums, CycloneDX SBOMs, VEX, vulnerability scans, release evidence, source identity, GitHub attestations, and OCI signatures verify against the published bytes.
- A clean consumer machine can follow `docs/security/release-verification.md` successfully.
- Release notes identify security changes, migrations, compatibility changes, known issues, upgrade steps, and rollback limits.
- The release owner approves publication and records the evidence location. AI output cannot provide this approval.

## Scope after `0.1.0`

Keep these features out of the first stable release unless the product owner moves them into the frozen scope:

- Multi-organization hosting and organization switching.
- A hosted SaaS control plane.
- Scanner ingestion, questionnaire workflows, or a general workflow designer.
- Automated portal submission or autonomous vendor contact.
- AI approval of facts, scores, novelty, fixes, submissions, or publications.
- Mobile applications.
- Plugin execution or arbitrary command providers inside the desktop application.
- SLSA Source Level 4 or assurance claims that require a second trusted maintainer or an external authority.

These exclusions protect the first release from turning into a different product. Revisit them through a written product decision after `0.1.0` usage provides evidence.

## Maintaining this roadmap

Review this file at each version bump. For every shipped item, link the pull request, acceptance test, operator documentation, and release evidence in the feature register. Record scope changes in the changelog. Never mark a milestone complete because most of its work is done.
