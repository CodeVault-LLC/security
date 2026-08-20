# Self-host CodeVault Security in production

This is the supported baseline for a single-host deployment. It runs the API, general worker, isolated media worker, PostgreSQL, and MinIO with private data networks. Only the API binds to the host, and it binds to loopback so a TLS reverse proxy can be the public entry point.

## Before you begin

Use a dedicated, patched Linux host with Docker Engine and Compose v2. Store secrets and backups outside the repository. Obtain the immutable digests for the signed `server`, `worker`, and `media-worker` images from an official release.

Verify each image before deployment. Replace `<digest>` and keep the full repository identity check:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/CodeVault-LLC/security/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/codevault-llc/security/server@sha256:<digest>

gh attestation verify \
  oci://ghcr.io/codevault-llc/security/server@sha256:<digest> \
  --repo CodeVault-LLC/security
```

Repeat both commands for the worker and media-worker. See [`../security/release-verification.md`](../security/release-verification.md) for release-asset verification.

## Create configuration and secrets

Create the secret directory outside the checkout. The command refuses a repository path or a non-empty directory and creates files with mode `0600`:

```bash
bun run production:secrets -- /var/lib/codevault/secrets
install -m 0600 infra/production.env.example /etc/codevault/production.env
```

Edit `/etc/codevault/production.env`. Set all three images to immutable `name@sha256:digest` references, set `CODEVAULT_SECRETS_DIR=/var/lib/codevault/secrets`, and set the public browser origin in `SERVER_CORS_ORIGINS` when required. Do not use mutable tags.

Back up the secret directory to an encrypted secret store before starting. Losing `mfa_encryption_keys` prevents recovery of enrolled TOTP secrets. Treat database, MinIO, MFA, Gmail, and signing credentials as separate rotation domains.

## Start the deployment

Run Compose from the repository root so relative policy and SQL mounts resolve correctly:

```bash
docker compose \
  --env-file /etc/codevault/production.env \
  -f infra/compose.production.yml \
  config --quiet

docker compose \
  --env-file /etc/codevault/production.env \
  -f infra/compose.production.yml \
  up -d
```

The one-shot jobs create the least-privilege database roles, apply migrations with the migrator identity, grant runtime access, and provision separate MinIO identities for the API and media worker. Application containers use read-only filesystems, no Linux capabilities, non-root image users, PID and memory limits, and isolated networks. PostgreSQL and MinIO are not published on the host.

Inspect startup status and logs without copying secret files into support tickets:

```bash
docker compose --env-file /etc/codevault/production.env \
  -f infra/compose.production.yml ps
docker compose --env-file /etc/codevault/production.env \
  -f infra/compose.production.yml logs --since 15m server worker media-worker
```

## Terminate TLS

Place a maintained reverse proxy on the host or a trusted adjacent ingress. Proxy HTTPS to `127.0.0.1:${CODEVAULT_PORT:-4310}`. Require TLS 1.2 or later, automate certificate renewal, set request-body and timeout limits that accommodate the configured upload size, and preserve the client IP only through a trusted proxy configuration.

Do not publish PostgreSQL port 5432 or MinIO port 9000. Restrict host firewall access to the management plane and HTTPS. Limit outbound traffic where practical, while allowing the configured AI, vulnerability-intelligence, Gmail, and update services that the deployment actually uses.

## Create the first administrator

Use an interactive terminal because the command displays TOTP enrollment and recovery secrets:

```bash
docker compose --env-file /etc/codevault/production.env \
  -f infra/compose.production.yml run --rm server \
  node dist/admin-create.js \
  --organization "Your Organization" \
  --email admin@example.gov \
  --name "Initial Administrator"
```

Store the recovery codes in an approved password or secrets manager. Do not capture the terminal in centralized session recording unless that system is authorized to retain authentication secrets.

## Back up and restore

Back up these items together under the same recovery point objective:

- A PostgreSQL custom-format dump.
- The complete `objectstore-data` volume or a consistent MinIO replication target.
- The external secret directory and reverse-proxy configuration.
- The production environment file, excluding any value supplied separately by the host.

Test restoration on an isolated host at least quarterly and before a high-risk upgrade. Restore secrets, PostgreSQL, and object storage before starting the application. Verify an administrator login, evidence download, preview job, audit history, and a new backup. A database-only restore is incomplete because artifact metadata and object bytes must agree.

## Upgrade and roll back

1. Read the release notes and verify the new image signatures, attestations, SBOMs, VEX, and checksums.
2. Take and verify a pre-upgrade backup.
3. Replace all three image digests in the environment file as one change.
4. Run `docker compose config --quiet`, then `docker compose up -d`.
5. Confirm the migration job completed and exercise authentication, evidence, worker, and media paths.

Application rollback may be unsafe after a forward-only database migration. Restore the pre-upgrade database and object-store recovery point when the release notes do not explicitly support application-only rollback.

## Monitoring and incident evidence

Centralize container, reverse-proxy, host, database, and object-store logs with access control and tamper-resistant retention. Alert on repeated authentication failures, unexpected administrator or organization changes, worker crash loops, media timeouts, storage failures, audit-write failures, and release-image changes. Collect image digests, configuration hashes, relevant logs, audit events, and the release evidence manifest during an incident. Never collect decrypted evidence or credentials unless the response plan explicitly authorizes it.

The operator owns host hardening, TLS, identity-provider policy, backups, monitoring, retention, incident response, data residency, and deployment assessment. The repository evidence does not certify a particular installation.
