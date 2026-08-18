# CodeVault worker.
#
# Carries a browser, because it renders report PDFs, and decodes uploaded files.
# Both are reasons it is a separate image and a separate process from the API:
# the riskiest work does not belong in the container answering authenticated
# requests.

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

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime

WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist

RUN groupadd --system --gid 10001 codevault \
 && useradd --system --uid 10001 --gid codevault --create-home codevault \
 && chown -R codevault:codevault /app

USER codevault

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
