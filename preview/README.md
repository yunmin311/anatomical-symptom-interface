# The ASI preview environment

**A demonstration deployment. Not a product.**

| | |
|---|---|
| Clinically reviewed | **No** — 10 of 10 safety rules unreviewed, 7 of them urgent/emergency |
| Approved for medical release | **No** |
| 2D anatomy | **Placeholder artwork**, hand-made, not anatomical |
| FMA bindings | **Unverified** |
| Data | **Synthetic only.** Rebuilt on every start |
| Real patients | **Never.** This must not be pointed at real health data |

The running service states all of this itself, in `GET /api/health`, so a reviewer can ask it
rather than take this file's word for it:

```json
{
  "releaseReady": false,
  "unreviewedSafetyRules": 10,
  "totalSafetyRules": 10,
  "clinicalReview": "not-reviewed",
  "build": { "commit": "eaf69e9…", "deployKind": "preview" },
  "previewNotice": "Preview deployment. Synthetic data only. NOT clinically reviewed…"
}
```

## Start it

```bash
pnpm install
pnpm --filter @asi/web build     # the preview serves the real production build
bash preview/preview.sh start    # http://127.0.0.1:8080
bash preview/preview.sh status
bash preview/preview.sh stop
```

`preview/start.mjs` boots the API, seeds the demo data, and serves the web build and the API
on **one origin**. `preview/preview.sh` wraps it with readiness polling, so "started" means
both halves answered, not that a port got bound.

## Verify it

```bash
node preview/verify-preview.mjs http://127.0.0.1:8080
```

This is not ceremony. The first version of the proxy here passed the request stream straight
through as a fetch body, which undici rejects without `duplex: 'half'`: **every GET worked and
every POST returned 502.** The page rendered, the health map drew real data from the server,
and the entire write half of the product was dead — reported to the user as "Location service
unavailable". Looking at the preview would not have caught it. So the verifier asserts on the
things a screenshot cannot show: that a **write** round-trips, that refusals keep their
envelope instead of degrading into 502s, that the deployment identifies itself as a preview,
and that the demo data is synthetic.

Confirming that claim: reintroducing the streaming body makes exactly the three write-path
checks fail while the nine read-only ones still pass.

## What is deployed

| | |
|---|---|
| **Web** | the real `apps/web/dist` build — the same bytes that ship, not a dev server |
| **HTTP API** | `@asi/server` on `ASI_DEPLOY_KIND=preview`, seeded with the synthetic demo record |
| **MCP** | documented in [`mcp/README.md`](mcp/README.md), with a client config in [`mcp/asi-preview.mcp.json`](mcp/asi-preview.mcp.json) |

### One origin, and why

The web client calls `fetch('/api/…')` — a **relative** path. That is correct for the product:
the browser is never told where the API is, so there is no per-environment API setting to get
wrong. The cost is that something must serve both on one origin and route `/api`.

Development gets that from Vite's `server.proxy`. A built bundle had nothing: `vite preview`
reads `preview.proxy`, not `server.proxy`, so `pnpm build && vite preview` served the app and
404'd every API call. `preview/serve.mjs` is that missing piece, with no dependency beyond
Node — which also means the preview serves the production build rather than a dev server, so
a flow that passes here passed against the bytes that would deploy.

## Containers

```bash
ASI_BUILD_COMMIT=$(git rev-parse HEAD) docker compose -f preview/docker-compose.yml up --build
node preview/verify-preview.mjs http://127.0.0.1:8080
```

Two honest caveats:

1. **The container path is not exercised by CI**, which runs on Node directly and has no
   daemon. Compose is the portable deployment option; the verifier is what proves a preview
   works. Always run the verifier against whatever you started.
2. The port is bound to **loopback**. A preview full of unreviewed safety rules has no business
   being network-reachable, and publishing that port is the easiest way to turn a demo into an
   incident. Put TLS and real access control in front of it before showing anyone.

## Layout

```text
preview/
  start.mjs             boot API → seed → one origin, with readiness polling
  serve.mjs             static build + /api proxy, traversal-guarded
  verify-preview.mjs    12 checks; fails loudly on the things a screenshot cannot show
  preview.sh            start | stop | restart | status | log
  Dockerfile            portable image
  docker-compose.yml    portable deployment, loopback-bound
  mcp/                  MCP client config and what MCP actually is
```

Runtime state lives in `preview/.preview-data/` and is gitignored.

## What this preview is for

Showing the V1 flow end to end and collecting usability feedback. Nothing else. It is not a
staging environment for real data, and it is not a step toward release on its own — see
[`../POST_V1_PLAN.md`](../POST_V1_PLAN.md) for what stands between this and a medical product.