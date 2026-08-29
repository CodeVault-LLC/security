# CodeVault worker.
#
# Carries a browser, because it renders report PDFs, and decodes uploaded files.
# Both are reasons it is a separate image and a separate process from the API:
# the riskiest work does not belong in the container answering authenticated
# requests.

FROM oven/bun:1.4-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef AS builder

WORKDIR /build

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/media-worker/package.json apps/media-worker/
COPY apps/desktop/package.json apps/desktop/
COPY packages/ai/package.json packages/ai/
COPY packages/cli/package.json packages/cli/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/exchange/package.json packages/exchange/
COPY packages/markdown/package.json packages/markdown/
COPY packages/mcp/package.json packages/mcp/
COPY packages/reporting/package.json packages/reporting/
COPY packages/standards/package.json packages/standards/
COPY packages/ui/package.json packages/ui/

RUN bun install --frozen-lockfile --ignore-scripts

COPY packages packages
COPY apps/server apps/server
COPY apps/worker apps/worker
COPY apps/media-worker apps/media-worker

RUN bun build apps/worker/src/index.ts \
      --target=node \
      --outdir=/build/dist \
      --format=esm \
      --external playwright \
      --external playwright-core \
      --external sharp \
      --external pagedjs

FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e AS runtime

LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist

RUN groupadd --system --gid 10001 codevault \
 && useradd --system --uid 10001 --gid codevault --create-home codevault \
 && chown -R codevault:codevault /app \
 && rm -rf /usr/lib/node_modules/npm \
 && find /app/node_modules/.bun -maxdepth 1 -name '@esbuild+*' -exec rm -rf '{}' +

COPY LICENSE NOTICE /licenses/

USER codevault

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
