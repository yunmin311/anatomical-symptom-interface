# The preview image.
#
# NOT VERIFIED IN CI, and honest about why: it needs a Docker daemon, and this repository's
# gates run directly on Node. So this file is a portable deployment path, and
# `preview/verify-preview.mjs` is what proves a preview works regardless of how it was
# started. Run the verifier against the container; do not assume it works because it built.

# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app

# pnpm via corepack, pinned by the repo's packageManager field.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Dependencies first, on their own layer, so a source-only change does not reinstall.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json  packages/shared/
COPY packages/server/package.json  packages/server/
COPY packages/mcp/package.json     packages/mcp/
COPY apps/web/package.json         apps/web/
RUN pnpm install --frozen-lockfile

COPY . .

# The web build is what the preview serves; nothing else in this image is a static asset.
RUN pnpm --filter @asi/web build

# ---------- run ----------
FROM node:24-slim AS run
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production \
    ASI_PREVIEW_PORT=8080 \
    ASI_API_PORT=8787 \
    ASI_DB_PATH=/data/preview.sqlite \
    ASI_DEPLOY_KIND=preview \
    ASI_RELEASE_PROFILE=development \
    ANTHROPIC_API_KEY=

# Production dependencies only. The workspace packages are linked, not copied from a registry,
# so the whole workspace has to be present -- hence copying sources rather than installing a
# published package that does not exist.
COPY --from=build /app /app
RUN corepack enable && pnpm install --frozen-lockfile --prod

# The commit is a build argument on purpose. There is no `.git` in the image, and reading one
# at runtime would report `unknown` -- so a preview that cannot say which build it is would be
# indistinguishable from any other. Pass it: --build-arg ASI_BUILD_COMMIT=$(git rev-parse HEAD)
ARG ASI_BUILD_COMMIT=unknown
ENV ASI_BUILD_COMMIT=$ASI_BUILD_COMMIT

# Synthetic demo data only, and never real health data.
VOLUME ["/data"]
EXPOSE 8080

# Reports unhealthy while the safety rules are unreviewed, which is the honest state. A health
# check that required `releaseReady` would report this preview permanently unhealthy for
# correctly refusing to be a medical product.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ASI_PREVIEW_PORT||8080)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "preview/start.mjs"]