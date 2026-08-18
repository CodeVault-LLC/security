# CodeVault API server.
#
# Two stages: a builder that installs the workspace and bundles the server, and
# a runtime that carries only the bundle and its native dependencies. The
# runtime runs as a non-root user and holds no source, no lockfile and no
# development tooling.

FROM oven/bun:1.3-debian AS builder

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
COPY packages/reporting/package.json packages/reporting/
COPY packages/standards/package.json packages/standards/
COPY packages/ui/package.json packages/ui/

RUN bun install --frozen-lockfile --ignore-scripts

COPY packages packages
COPY apps/server apps/server

RUN bun build apps/server/src/index.ts \
      --target=node \
      --outdir=/build/dist \
      --format=esm

FROM node:24-bookworm-slim AS runtime

# Argon2 is a native module, so its prebuilt binary comes across from the
# builder rather than being rebuilt here.
COPY --from=builder /build/node_modules/@node-rs /app/node_modules/@node-rs

WORKDIR /app

COPY --from=builder /build/dist ./dist
COPY --from=builder /build/packages/db/drizzle ./drizzle

RUN groupadd --system --gid 10001 codevault \
 && useradd --system --uid 10001 --gid codevault codevault \
 && chown -R codevault:codevault /app

USER codevault

ENV NODE_ENV=production
EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4310/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
