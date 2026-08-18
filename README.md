# CodeVault

A security research, evidence and coordinated-disclosure platform for people who
find vulnerabilities in real things: software components, applications, APIs,
devices, firmware, hardware, services, hosts and cloud resources.

It is deliberately not a vulnerability-management suite. There is no scanner
ingestion, no questionnaire engine, no workflow designer and no severity
pie chart on the front page. The work it is built around is the work of
discovering something, proving it, deciding what it means, and disclosing it
responsibly.

## The two rules

**AI drafts; humans own truth.** Claude Code or Codex CLI may propose text, a
classification, CVSS metrics or a rewrite. A model cannot record that a finding
is novel, confirmed, fixed, approved or published. Every AI result arrives as a
proposal with Accept, Edit and Reject, and the researcher can see the exact
context — item by item, with digests — before anything leaves their machine.

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
  worker/    Background jobs: prior art, previews, PDF export, Gmail send/sync
packages/
  core/      Domain rules: permissions, visibility, states, policy packs, identifiers
  standards/ CVSS 4.0 and 3.1, CWE, TLP, external identifier schemes
  contracts/ TypeBox schemas shared by the server and the client
  db/        Drizzle schema and hand-written SQL migrations
  reporting/ Directives, sanitised Markdown, the report linter, print CSS, PDF
  ai/        Action registry, output schemas, context filtering, proposal mapping
  ui/        Theme tokens and the semantic security components
infra/       Development stack and container images
docs/        Threat model, AI security, data model, report model
scripts/     Dev runner, administrator bootstrap, development seed, env check
```

## Getting started

Requires Node 24, Bun 1.3 and Docker.

```bash
cp .env.example .env    # before bun install: the scripts below read it
bun install             # also downloads the Electron binary (~220 MB)
docker compose -f infra/docker-compose.yml up -d

set -a; . ./.env; set +a

bun run db:migrate
bun run admin:create --email you@example.com --name "Your Name"
bun run verify:env

# Optional: three realistic cases to look at
bun run seed:dev
```

Then start the stack:

```bash
bun run dev              # API on :4310, worker, and the desktop client
bun run dev:services     # API and worker only
```

The three read `.env` from the repository root. `bun run dev` starts them as
peers rather than through `bun run --filter`, which waits for a dependency's
script to finish — the worker depends on the server package, so it would never
start behind a server that is meant to keep running.

If the desktop client reports "Electron uninstall", the binary download did not
complete during install. Run `bun run electron:install` to retry it; nothing
else in the repository needs it.

There is no registration page. The first administrator is created by the CLI
above; everyone else arrives through an expiring, single-use invitation.

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

## Packaging

```bash
bun run --cwd apps/desktop package
```

macOS produces a DMG and a ZIP for arm64 and x64, Windows an NSIS installer,
Linux an RPM for Fedora and an AppImage. Each platform is built and signed on
its own CI runner; signing credentials come from the environment and are never
committed.

## Where to read next

- [`docs/architecture/threat-model.md`](docs/architecture/threat-model.md) —
  what is being protected, from whom, and which code and test enforce each
  boundary.
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

## Licence

Not yet chosen. Treat this repository as all rights reserved until it is.
