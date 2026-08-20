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
RUN sharp_dir="$(find node_modules/.bun -maxdepth 3 -path '*/node_modules/sharp' -type d -print -quit)" \
 && test -n "$sharp_dir" \
 && ln -s "${sharp_dir#node_modules/}" node_modules/sharp
COPY apps/media-worker apps/media-worker
COPY packages/core packages/core
COPY packages/db packages/db
RUN bun build apps/media-worker/src/index.ts --target=node --outdir=/build/dist \
    --format=esm --external sharp

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS runtime
LABEL org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
RUN groupadd --system --gid 10002 media \
 && useradd --system --uid 10002 --gid media --no-create-home media \
 && rm -rf /usr/local/lib/node_modules/npm \
 && find /app/node_modules/.bun -maxdepth 1 -name '@esbuild+*' -exec rm -rf '{}' +
COPY LICENSE NOTICE /licenses/
USER 10002:10002
ENV NODE_ENV=production
ENV VIPS_BLOCK_UNTRUSTED=1
CMD ["node", "dist/index.js"]
