# Hostile image decoding runs in its own small, non-root image. Runtime limits
# and the read-only filesystem are applied by the orchestrator, not baked into
# the image where they could be accidentally assumed rather than enforced.
FROM oven/bun:1.3-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS builder
WORKDIR /build
COPY package.json bun.lock ./
COPY apps/media-worker/package.json apps/media-worker/
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
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
# The bundle externalizes sharp so the native module is loaded by Node at
# runtime. Bun links workspace dependencies below the workspace package; add a
# root link that remains valid when node_modules is copied into the final image.
RUN cd node_modules && ln -s .bun/sharp@0.35.3+*/node_modules/sharp sharp
COPY apps/media-worker apps/media-worker
COPY packages/core packages/core
COPY packages/db packages/db
RUN bun build apps/media-worker/src/index.ts --target=node --outdir=/build/dist \
    --format=esm --external sharp

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime
LABEL org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
RUN groupadd --system --gid 10002 media \
 && useradd --system --uid 10002 --gid media --no-create-home media
COPY LICENSE NOTICE /licenses/
USER 10002:10002
ENV NODE_ENV=production
ENV VIPS_BLOCK_UNTRUSTED=1
CMD ["node", "dist/index.js"]
