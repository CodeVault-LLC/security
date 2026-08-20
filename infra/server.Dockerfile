# CodeVault API server.
#
# Two stages: a builder that installs the workspace and bundles the server, and
# a runtime that carries only the bundle and its native dependencies. The
# runtime runs as a non-root user and holds no source, no lockfile and no
# development tooling.

FROM oven/bun:1.3-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS builder

WORKDIR /build

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/media-worker/package.json apps/media-worker/
COPY apps/desktop/package.json apps/desktop/
COPY packages/ai/package.json packages/ai/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/markdown/package.json packages/markdown/
COPY packages/mcp/package.json packages/mcp/
COPY packages/reporting/package.json packages/reporting/
COPY packages/standards/package.json packages/standards/
COPY packages/ui/package.json packages/ui/

RUN bun install --frozen-lockfile --ignore-scripts

COPY packages packages
COPY apps/server apps/server
COPY scripts/bootstrap-admin.ts scripts/bootstrap-admin.ts

RUN bun build apps/server/src/index.ts \
      --target=node \
      --outdir=/build/dist \
      --format=esm

RUN bun build packages/db/src/migrate-cli.ts \
      --target=node \
      --outfile=/build/dist/migrate.js \
      --format=esm

RUN bun build scripts/bootstrap-admin.ts \
      --target=node \
      --outdir=/build/dist \
      --entry-naming=admin-create.js \
      --format=esm

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime

LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Bun places the platform-specific Argon2 binary beside each bundled entry
# point. Copying the bundle therefore keeps the native dependency without
# carrying the full build-time dependency tree into the runtime image.
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/packages/db/drizzle ./drizzle

RUN groupadd --system --gid 10001 codevault \
 && useradd --system --uid 10001 --gid codevault codevault \
 && chown -R codevault:codevault /app \
 && rm -rf /usr/local/lib/node_modules/npm

COPY LICENSE NOTICE /licenses/

USER codevault

ENV NODE_ENV=production
EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
