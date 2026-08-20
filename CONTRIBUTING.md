# Contributing to CodeVault Security

CodeVault accepts focused changes that preserve its security invariants and keep the build reproducible. Do not use a public issue or pull request to disclose a suspected vulnerability. Follow the private reporting instructions in `SECURITY.md`.

## Prepare the workspace

Use Bun 1.3.14 and Node.js 24. Install the exact dependency graph:

```sh
bun install --frozen-lockfile
```

Start the development infrastructure and apply migrations:

```sh
docker compose -f infra/docker-compose.yml up -d
bun run db:migrate
```

## Submit a change

1. Open an issue or discussion for a change that alters public behavior, stored data, a trust boundary, or a release format.
2. Add or update tests for changed behavior. Security fixes need a regression test when a safe, stable test can reproduce the failure.
3. Update the threat model when the change adds an actor, asset, attacker-controlled input, or trust boundary.
4. Run the required checks:

   ```sh
   bun run lint
   bun run format:check
   bun run typecheck
   bunx vitest --run --project node --project dom
   bun run build
   bun audit --audit-level=moderate
   ```

5. Open a pull request. Describe the behavior change, security effect, test evidence, and any remaining risk.

Do not commit generated executables, credentials, filled environment files, customer data, vulnerability evidence, or local release outputs.

## Contributor authority

By submitting a contribution, you state that you have the right to submit it under the project's selected license. The project may require a Developer Certificate of Origin or another contribution agreement before accepting outside contributions.

AI tools may help draft code or review a change. The contributor remains responsible for the submitted work, its license, its tests, and every security claim. AI approval does not replace maintainer approval.
