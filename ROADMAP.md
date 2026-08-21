# CodeVault Security roadmap

Status: Active

Last reviewed: 2026-08-21

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

## Who `0.1.0` is for

The first supported release is for a research or product-security team with 2 to 10 members. The team performs original vulnerability research, handles embargoed evidence, and coordinates disclosure with vendors. The team accepts self-hosting because it needs custody of the research corpus.

The release does not try to replace scanner aggregation, ticketing, a bug-bounty platform, or a pentest consultancy portal. It must earn adoption by making one sensitive research case safer and easier to finish than the team's existing combination of files, Markdown, and email.

## Adoption outcomes

The following outcomes are release work. They are not marketing measurements.

1. **Evaluate.** A person who has not contributed to CodeVault can start a disposable deployment, open a realistic sample case, and export a vendor report within 15 minutes. The person does not need a source checkout, Node, Bun, Gmail, or an AI provider.
2. **Bring existing work.** A researcher can preview and import a directory of Markdown, JSON, CSV, and attachments into a new or existing case. The import identifies duplicates, preserves original files, and makes no authoritative claim without review.
3. **Reach first value.** A first-run path takes a researcher through creating or importing a case, recording one finding and its evidence, and producing a vendor-report preview. The path shows the value before asking for mail or AI access.
4. **Keep control of the data.** A researcher can export a complete, versioned case archive and import it into a clean compatible deployment. The archive has a manifest, record counts, artifact digests, visibility metadata, and an option to encrypt the export for named recipients.
5. **Collaborate without exposing every case.** An administrator can grant read or write access to a case. A user without read access cannot discover the case, its title, activity, metrics, search matches, evidence, reports, or identifiers.
6. **Recover.** An operator can back up PostgreSQL, object storage, and required secrets as one recovery point. The operator can restore that point into an empty deployment and verify record counts and artifact digests.
7. **Return to unfinished work.** Drafts, uploads, imports, exports, AI proposals, report rendering, and delivery jobs survive interruption or fail with a visible recovery action.
8. **Communicate through a real team mailbox.** CodeVault supports manual delivery, Gmail, and Microsoft 365 through the same reviewed submission and correspondence rules. Provider failure never causes an automatic duplicate send.
9. **Install software that identifies itself.** Signed desktop packages show their version, channel, server compatibility, and publisher before and after sign-in. Updates preserve active work and verify the new artifact before installation.
10. **Get help without leaking research.** A user can create a redacted diagnostic bundle that includes versions, health results, job identifiers, and configuration names. It excludes case content, addresses, tokens, filenames, and evidence bytes.

## What has to be built

### A supported evaluation path

- Publish a disposable evaluation bundle with synthetic cases and fixed local credentials. Keep it separate from production data and make removal explicit.
- Add a connection and preflight screen that checks the server version, database, object storage, workers, and clock before the user signs in.
- Add a first-run checklist for create or import, finding, evidence, vendor-report preview, and archive export. Let the user dismiss it and reopen it.
- Add a guided sample case that explains the three report audiences through actual records. Do not require AI, mail, or external network access.
- Publish a five-minute evaluation guide and a separate production-installation guide. Do not mix evaluation shortcuts into production instructions.

### Migration and capture

- Add a folder importer for Markdown, JSON, CSV, images, captures, and arbitrary attachments. Show a preview, mapping errors, duplicate candidates, visibility, and the exact records that acceptance will create.
- Add a small `codevault capture` command for files and standard input. It records the case, evidence type, visibility, source time, original name, size, and digest without opening the desktop client.
- Complete external-agent intake and the MCP domain needed to create drafts, attach evidence, inspect readiness, and prepare reports. Direct approval and disclosure operations remain explicit and audited.
- Add a versioned `.cvcase` archive. Export and import must stream large artifacts, verify digests, reject path traversal, report incompatible versions, and support cancellation without partial canonical records.
- Add generic CSV and JSON finding exchange. This is a migration boundary, not recurring scanner ingestion.
- Add an organization contact block and restrained report branding so a vendor report identifies the researcher, the return address, and the organization without editing generated files.

### Confidential collaboration

- Replace organization-wide read clearance with case read membership. Keep organization roles for administration and use case grants for read, write, approval, and disclosure authority.
- Add an access review that lists who can read, edit, approve, or disclose each case. Record every grant and revocation in the audit trail.
- Add passkeys through WebAuthn. Keep TOTP recovery during the transition and let an administrator require phishing-resistant authentication for privileged roles.
- Preserve the single-organization deployment boundary for `0.1.0`. Do not use multi-organization hosting as a substitute for correct case isolation.
- Add retention and deletion controls for closed cases, exports, quarantined uploads, logs, and backups. Deletion must show scope, delay, legal-hold conflicts, and the parts an operator must remove outside the application.

### Daily research and disclosure

- Make drafts and pending work recoverable across create, edit, upload, import, AI, export, submission, and synchronization flows.
- Add bulk intake decisions, finding assignment and state changes, evidence classification, and vendor-route review. Every bulk action shows its object count and permission failures before it commits.
- Finish TLP controls, prior-art retry behavior, EPSS refresh, and KEV refresh. Mark stale or failed intelligence instead of presenting it as current.
- Add durable notifications and a failed-job view for invitations, MFA changes, failed jobs, vendor replies, disclosure dates, stale intelligence, and expiring mail connections.
- Finish Gmail delivery and synchronization. Add Microsoft 365 delivery and synchronization through Microsoft Graph. Apply the same sealing, idempotency, reply-correlation, and audit rules to both providers.
- Add a provider-independent correspondence export so a team can leave CodeVault or change mail providers without losing the disclosure record.
- Complete keyboard, screen-reader, 200 percent zoom, reduced-motion, contrast, long-content, and network-failure paths for the core research and disclosure flows.

### Trust, distribution, and operations

- Add backup and restore commands for one consistent PostgreSQL and object-storage recovery point. Include a manifest and a verification command.
- Test upgrades from every published prerelease snapshot. Block incompatible server, worker, media-worker, MCP, and desktop versions before they mutate data.
- Add health, readiness, queue depth, job age, failure counts, storage reachability, database pressure, mail-watch expiry, and build-version telemetry without case content.
- Add bounded retries, dead-letter inspection, safe replay, and cancellation where the job allows it. Require idempotency evidence for every job that communicates externally.
- Publish signed desktop packages and immutable OCI images. Add verified Stable, Beta, and Alpha update channels before inviting external pilot teams to store real research.
- Publish supported operating systems, CPU architectures, PostgreSQL versions, S3-compatible services, mail prerequisites, and minimum workstation and server resources.
- Commission an independent security assessment before stable release. Apply the repository protections, rehearse vulnerability response and release withdrawal, and verify a real release as a consumer.
- Add API contract, migration, load, failure, and long-running worker tests. Keep the feature register as the link between each supported capability, its acceptance test, its documentation, and its release evidence.

## Pilot evidence

CodeVault does not enter beta on implementation evidence alone. Record these results without collecting unpublished vulnerability details:

- Five people who have not contributed to the repository complete the evaluation outcome. At least four finish without the maintainer taking control of their machine or deployment.
- Three external teams import an existing historical or sanitized case, add new evidence, and export a vendor report.
- Two external teams use the same deployment for at least 30 days and return to an unfinished case after an update or service interruption.
- One pilot uses case-level read restrictions with at least three users and proves that an ungranted user cannot discover the case through any interface.
- One operator who did not write the backup code restores a pilot deployment into an empty environment and verifies the archive and artifact manifests.
- Every accepted pilot blocker has an owner and a target release. Publish aggregate completion times, failure categories, and abandonment points without user or case identifiers.

## Versioning rules

Continue the current line as `0.1.0-alpha.N`. Do not publish `0.1.1-alpha.1` before `0.1.0`, because SemVer treats it as development toward a version after `0.1.0`. Use this order:

```text
0.1.0-alpha.5
0.1.0-alpha.6  current, then through alpha.10
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

### `0.1.0-alpha.7`: Let people evaluate the product

Goal: let a new evaluator reach the report-projection value without adopting the product first.

- Publish the disposable evaluation bundle with synthetic data and no external-service requirement.
- Add server connection preflight and compatibility diagnostics.
- Add the first-run checklist and the guided sample case.
- Add the organization contact block and basic report branding.
- Build signed test packages from a tagged release and display the exact version and publisher.
- Write separate evaluation, production installation, and removal guides.
- Run the evaluation path with five non-contributors and record time, failures, and abandonment points.

Exit criteria: at least four of five evaluators start CodeVault and export the sample vendor report within 15 minutes without the maintainer taking control.

### `0.1.0-alpha.8`: Bring existing research into CodeVault

Goal: let a researcher adopt CodeVault with an existing case instead of starting from an empty database.

- Add folder intake for Markdown, JSON, CSV, images, captures, and arbitrary attachments with preview, mapping, deduplication, cancellation, and audit history.
- Add `codevault capture` for files and standard input.
- Add generic CSV and JSON finding exchange.
- Add the versioned `.cvcase` archive with verified, resumable export and all-or-nothing import.
- Complete the MCP operations needed for draft intake, evidence, readiness, and report preparation.
- Make create, edit, upload, import, AI, export, and report-rendering work recoverable after interruption.
- Add end-to-end scenarios for importing a historical case, adding evidence, reviewing intake, approving a report, exporting PDF and Markdown, and moving the case to a clean deployment.
- Run this path with three external teams.

Exit criteria: each pilot team imports existing work, produces a vendor report, exports the complete case, and imports it into a clean compatible deployment without direct database edits or lost artifacts.

### `0.1.0-alpha.9`: Make team research and disclosure safe

Goal: let a small team collaborate on real embargoed research without exposing every case or depending on Gmail.

- Add case-level read, write, approval, and disclosure grants. Hide ungranted case existence across every query and interface.
- Add case access review and audit history for grants and revocations.
- Add WebAuthn passkeys and an organization policy that can require them for privileged roles.
- Add bulk intake review, finding assignment and state changes, evidence classification, and vendor-route review with a dry-run summary.
- Finish TLP controls, prior-art retry behavior, EPSS refresh, and KEV refresh.
- Add durable notifications and a failed-job view.
- Finish Gmail delivery and synchronization. Add Microsoft 365 delivery and synchronization through Microsoft Graph.
- Add provider-independent correspondence export.
- Test manual, Gmail, Microsoft 365, plaintext, encrypted, signed, reply, quota, revocation, replay, and delivery-unknown paths.
- Add route expiry, stale-key, missed-follow-up, and disclosure-deadline warnings.

Exit criteria: a three-person pilot proves case isolation, completes a reviewed vendor delivery, recovers from a simulated provider failure, and exports the correspondence record. No network retry sends a submission twice.

### `0.1.0-alpha.10`: Make adoption recoverable

Goal: make a self-hosted pilot safe to operate, update, diagnose, and leave running.

- Add consistent backup and restore commands for PostgreSQL, object storage, and required secrets.
- Rehearse restore into an empty deployment and compare record counts and artifact digests.
- Test upgrades from every published alpha snapshot. Document rollback limits and block unsafe version skew.
- Add health, readiness, queue, storage, database, mail-watch, and build-version telemetry.
- Add dead-letter inspection, bounded retries, cancellation, and safe job replay.
- Add a redacted diagnostic bundle and verify its exclusion rules with hostile fixture data.
- Publish supported platforms, dependencies, resource requirements, and scale budgets.
- Add protected update feeds for signed macOS, Windows, and supported Linux artifacts. Publish Stable, Beta, and Alpha metadata.
- Add update checks, release notes, download progress, verification, deferral, installation, restart handling, and failure recovery.
- Show the exact application version, update channel, platform, architecture, and server compatibility before and after sign-in.
- Test channel promotion, SemVer ordering, feed authenticity, digest mismatch, signature failure, interrupted downloads, rollback refusal, active-work deferral, and server compatibility.
- Complete the 30-day pilot, external restore rehearsal, and update-interruption evidence in **Pilot evidence**.

Exit criteria: an operator who did not build the feature installs, observes, backs up, restores, upgrades, and diagnoses a pilot deployment without direct database edits. The two 30-day pilot teams recover their unfinished work after an update or service interruption.

### `0.1.0-beta.1`: Feature complete

Goal: freeze everything intended for `0.1.0`.

- Close or defer every item in **What has to be built**.
- Complete every result in **Pilot evidence** and publish the aggregate evidence.
- Block beta publication unless updates from the latest alpha to `beta.1` pass on every supported desktop installation type.
- Freeze public API contracts, the database migration path, artifact names, configuration names, and the supported deployment shape.
- Complete keyboard-only, screen-reader, 200 percent zoom, reduced-motion, and contrast reviews for critical workflows.
- Add end-to-end coverage for authentication, recovery, invitations, restricted cases, all core research work, report export, vendor delivery, and recovery from failed jobs.
- Publish administrator, operator, researcher, integration, backup, restore, upgrade, and troubleshooting documentation.
- Continue the pilot feedback register. Give every accepted blocker an owner and target release.

Exit criteria: no planned `0.1.0` feature is missing, no known data-loss path is open, every adoption outcome has pilot evidence, and all supported workflows have acceptance evidence.

### `0.1.0-beta.2`: Security and compatibility complete

Goal: remove release blockers without adding product scope.

- Complete the ASVS 5.0.0 Level 3 self-assessment and record evidence per applicable requirement.
- Complete an independent security assessment. Fix all critical and high findings.
- Run failure, load, migration, backup, restore, and long-running worker tests.
- Apply and record the required GitHub organization, repository, tag, environment, and security settings.
- Revalidate Apple and Windows signing access, rotation, timestamping, and protected-environment restrictions.
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
- The evaluation bundle works without a source checkout, mail provider, AI provider, or access to production data.
- A new evaluator can reach the vendor-report preview through a sample case before the product requests optional integration access.
- Folder import, generic finding exchange, `codevault capture`, and `.cvcase` import and export pass against historical pilot cases.
- A complete `.cvcase` archive can move between clean compatible deployments without losing records, revisions, visibility, correspondence, or artifact bytes.
- No critical workflow depends on an optional AI provider.
- External communication and publication always require a permitted human action.
- Restricted case existence and content remain hidden from unauthorized users.
- Case access review shows every user who can read, write, approve, or disclose the case.
- Manual, Gmail, and Microsoft 365 disclosure paths preserve the same approval, sealing, idempotency, and audit rules.
- Import, export, backup, restore, upgrade, and failure recovery paths have passed against release artifacts.
- The application displays its exact version and selected update channel before and after sign-in.
- Stable, Beta, and Alpha channel selection works as documented. Stable is the default.
- Update checks, release notes, download, verification, deferral, installation, restart, and recovery have passed on every supported desktop installation type.
- The updater preserves active work, rejects untrusted or older artifacts, and gives users a verified manual path when self-update is unavailable.
- The redacted diagnostic bundle passes tests that seed case titles, addresses, filenames, tokens, and evidence markers and prove that none appear in the bundle.
- Accessibility acceptance covers keyboard use, focus, names, contrast, zoom, reduced motion, and non-color meaning.
- Every result in **Pilot evidence** is complete. The published aggregate contains no user, vendor, or vulnerability identifiers.

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
- An operator who did not implement backup and restore completes the documented recovery rehearsal on an empty host.
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
- Recurring scanner synchronization, scanner orchestration, questionnaire workflows, or a general workflow designer. Generic CSV and JSON migration remain in `0.1.0`.
- Automated portal submission or autonomous vendor contact.
- AI approval of facts, scores, novelty, fixes, submissions, or publications.
- Mobile applications.
- Plugin execution or arbitrary command providers inside the desktop application.
- SLSA Source Level 4 or assurance claims that require a second trusted maintainer or an external authority.

These exclusions keep the first release focused on original research and coordinated disclosure. Revisit them through a written product decision after the pilot evidence identifies a repeated job that the current product cannot complete.

## Maintaining this roadmap

Review this file at each version bump. For every shipped item, link the pull request, acceptance test, operator documentation, and release evidence in the feature register. Record scope changes in the changelog. Update the aggregate pilot evidence when a release changes an adoption outcome. Never mark a milestone complete because most of its work is done.
