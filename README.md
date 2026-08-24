# CodeVault Security

[![CI](https://github.com/CodeVault-LLC/security/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/CodeVault-LLC/security/actions/workflows/ci.yml)
[![Security](https://github.com/CodeVault-LLC/security/actions/workflows/security.yml/badge.svg?branch=master)](https://github.com/CodeVault-LLC/security/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/CodeVault-LLC/security/badge)](https://securityscorecards.dev/viewer/?uri=github.com/CodeVault-LLC/security)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Release stage: alpha](https://img.shields.io/badge/release-alpha-orange.svg)](https://github.com/CodeVault-LLC/security/releases)
[![SLSA target: Build L3](https://img.shields.io/badge/SLSA-Build%20L3%20target-6b4fbb.svg)](docs/security/release-policy.md)

> **Alpha software:** APIs, migrations, deployment behavior, and release formats
> can change without compatibility guarantees. Do not treat this release as
> production-ready or government-approved without an independent assessment.

The OpenSSF Scorecard is an automated measurement, not a certification or an
endorsement. The SLSA badge states an assurance target, not an achieved level.
The [security evidence index](docs/security/security-evidence-index.md) records
what is implemented, what has been verified, and which gaps remain.

CodeVault Security is a security research, evidence and coordinated-disclosure
platform for people who find vulnerabilities in real things: software
components, applications, APIs, devices, firmware, hardware, services, hosts
and cloud resources.

It is deliberately not a vulnerability-management suite. There is no scanner
ingestion, no questionnaire engine, no workflow designer and no severity
pie chart on the front page. The work it is built around is the work of
discovering something, proving it, deciding what it means, and disclosing it
responsibly.

## The two rules

**In-product AI drafts; humans own truth.** The desktop AI actions may propose
text, a classification, CVSS metrics, or a rewrite. They cannot record that a
finding is novel, confirmed, fixed, approved, or published. Every in-product AI
result arrives as a proposal with Accept, Edit, and Reject. The researcher can
inspect the exact filtered context and its digests before anything leaves the
deployment.

Authenticated MCP clients are a separate direct-operation interface. Their
tools act immediately as the signed-in user, including the reviewed approval
operations listed in the [generated MCP inventory](docs/operations/mcp-tool-inventory.md).
The server applies the same permissions, revisions, validation, and audit rules
as it does for desktop requests.

Existing findings can also enter a case through the intake queue. Intake is not
canonical data: every draft remains pending until a case writer accepts,
rejects, edits or merges it.

**One source of truth, three publication views.** The internal report, the vendor
report and the public advisory are projections of the same case. Internal
evidence cannot reach a public advisory: the rule is enforced when the AI context
is built, when a directive is resolved, before approval, and again in the worker
immediately before the PDF is rendered.

## Layout

```
apps/
  desktop/   Electron client: hardened main process, narrow preload bridge, React renderer
  server/    Fastify API: auth, cases, findings, evidence, reports, AI, search, audit
  worker/    Background jobs: prior art, artifact previews, PDF export, Gmail send/sync; EPSS/KEV refresh is partial
  media-worker/ Isolated JPEG/PNG decoding and metadata-free avatar derivatives
packages/
  core/      Domain rules: permissions, visibility, states, policy packs, identifiers
  standards/ CVSS 4.0 and 3.1, CWE, TLP, external identifier schemes
  contracts/ TypeBox schemas shared by the server and the client
  db/        Drizzle schema and hand-written SQL migrations
  reporting/ Directives, sanitised Markdown, the report linter, print CSS, PDF
  ai/        Action registry, output schemas, context filtering, proposal mapping
  mcp/       Authenticated stdio tools for terminal AI clients
  ui/        Theme tokens and the semantic security components
infra/       Development and hardened production deployment definitions
docs/        Architecture, operations, release, and compliance evidence
scripts/     Dev runner, administrator bootstrap, development seed, env check
```

## Getting started

Requires Node 24, Bun 1.3 and Docker.

```bash
cp .env.example .env    # before bun install: the scripts below read it
bun install             # also downloads the Electron binary (~220 MB)
docker compose -f infra/docker-compose.yml up -d

set -a; . ./.env; set +a

bun run admin:create --organization "Your Organization" \
  --email you@example.com --name "Your Name"
bun run verify:env

# Optional: three realistic cases to look at
bun run seed:dev
```

Then start the stack:

```bash
bun run dev              # API on :4310, worker, and the desktop client
bun run dev:services     # API and worker only
```

`admin:create` applies pending migrations before creating the organization.
`bun run dev` and `bun run dev:services` also apply pending migrations before
starting any process. The development runner starts the processes as peers
rather than through `bun run --filter`, which waits for a dependency's script
to finish. The worker depends on the server package, so it would never start
behind a server that is meant to keep running.

To delete all application data in the local development database and rebuild
the schema from every migration, run:

```bash
bun run db:reset
```

The command accepts only a local PostgreSQL URL, refuses `NODE_ENV=production`,
and asks you to type the database name. Use `bun run db:reset --yes` only in a
non-interactive development script. It does not delete object-store files.
`bun run db:migrate` remains available when you want to apply migrations
without starting the app.

To use CodeVault from Codex CLI, Claude Code, or another terminal MCP client,
run `bun run mcp:setup` once. The command signs you in, creates a revocable MCP
connection, and configures each installed AI client. See
[`docs/operations/mcp.md`](docs/operations/mcp.md).

If the desktop client reports "Electron uninstall", the binary download did not
complete during install. Run `bun run electron:install` to retry it; nothing
else in the repository needs it.

There is no public registration page. The first administrator is created by the
CLI above. It displays a terminal QR code for TOTP enrollment, verifies the
first authenticator code, and prints ten one-time recovery codes only after the
organization, membership, credential, and audit record commit atomically.
Everyone else arrives through an expiring, single-use invitation and must
enroll MFA before receiving a session.

After signing in, a user can register one or more YubiKeys or other FIDO2
security keys under **Settings → Security**. Configure `WEBAUTHN_RP_ID` and
`WEBAUTHN_ORIGIN` to the deployment's public HTTPS hostname before enrollment;
these values are cryptographically bound to every credential. The desktop runs
the WebAuthn prompt in a token-free, ephemeral window at that origin. TOTP and
recovery codes remain available during the transition. See
[`docs/architecture/yubikey-authentication.md`](docs/architecture/yubikey-authentication.md).

Rotate encrypted TOTP credentials after adding a new first entry to
`MFA_ENCRYPTION_KEYS` with `bun run mfa:rotate-key`. Use `--dry-run` first; the
command reports counts and never prints decrypted secrets.

## Checks

```bash
bun run lint
bun run format:check
bun run typecheck
bunx vitest --run --project node --project dom   # unit tests
bunx vitest --run --project node-integration     # needs DATABASE_URL
bun run build
DATABASE_URL=... bun run e2e -- tests/e2e/vendor-submission.spec.ts tests/e2e/gmail-thread-sync.spec.ts
```

The integration tests run against a real PostgreSQL on purpose. Case access is
partly SQL, and a security test against a mocked database proves very little.
The Gmail E2E suite uses a deterministic loopback provider and `.test`/`.invalid`
recipients. It cannot contact Google or a real vendor. See
[`docs/operations/gmail-integration.md`](docs/operations/gmail-integration.md).

The [feature register](docs/feature-register.md) records the current scope,
acceptance test for each implemented feature, and the remaining release target
for partial or planned work. The older design and implementation plans are
decision records, not status trackers.

## Packaging

```bash
bun run --cwd apps/desktop package
```

macOS produces a DMG and a ZIP for arm64 and x64, Windows an NSIS installer,
Linux an RPM for Fedora and an AppImage. Each platform builds on its native CI
runner. Alpha packages for macOS and Windows are unsigned test builds. Stable
releases require platform signing credentials, which are never committed.

Official releases also publish digest-addressed server, worker, and media-worker
images, CycloneDX 1.7 SBOMs, VEX, checksums, signatures, and GitHub
attestations. Read the [release policy](docs/security/release-policy.md) and
[verification guide](docs/security/release-verification.md) before consuming an
official artifact.

For a hardened single-host installation, follow
[Self-host CodeVault Security in production](docs/operations/self-hosted-production.md).
The production definition keeps PostgreSQL and object storage private, uses
file-backed secrets, and runs application images as non-root with read-only
filesystems and dropped capabilities.

## Where to read next

- [`docs/evaluation/alpha-7.md`](docs/evaluation/alpha-7.md) describes the
  disposable Alpha 7 sample-report evaluation path.
- [`docs/architecture/threat-model.md`](docs/architecture/threat-model.md) —
  what is being protected, from whom, and which code and test enforce each
  boundary.
- [`docs/architecture/organization-security.md`](docs/architecture/organization-security.md) —
  organization roles, read clearance, mandatory MFA, and categorized settings.
- [`docs/architecture/ai-security.md`](docs/architecture/ai-security.md) — the
  four gates every AI interaction passes through, and the list of fields a model
  can never write.
- [`docs/architecture/data-model.md`](docs/architecture/data-model.md) — why a
  finding has five independent states and why asset kinds are ecosystem-neutral.
- [`docs/architecture/report-model.md`](docs/architecture/report-model.md) — how
  directives, the linter and the export gate keep the three reports honest.
- [`docs/operations/vendor-seed-maintenance.md`](docs/operations/vendor-seed-maintenance.md)
  — provenance, expiry, key verification, and maintainer assignment for starter
  vendor routes.
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting, supported
  versions, security invariants, and reportability rules.
- [`docs/security/security-evidence-index.md`](docs/security/security-evidence-index.md)
  — release and assurance evidence, current gaps, and claim limitations.
- [`docs/compliance/README.md`](docs/compliance/README.md) — SLSA, SSDF, ASVS,
  OpenSSF OSPS, and NIST 800-53 targets and current assessment state.

## License

Copyright 2026 CodeVault LLC. Licensed under the
[Apache License 2.0](LICENSE).
