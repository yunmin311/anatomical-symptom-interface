/**
 * The preview server: ONE origin serving the web build and the API.
 *
 * ## WHY ONE ORIGIN, AND WHY THIS EXISTS AT ALL
 *
 * The web client calls `fetch('/api/...')` -- a RELATIVE path. That is correct for the
 * product: it means the browser never needs to be told where the API is, and there is no
 * CORS or API-origin setting to get wrong per environment.
 *
 * The cost is that something has to serve both on the same origin and route `/api` to the
 * API. In development Vite does it (`server.proxy`). For a built bundle there was nothing:
 * `vite preview` reads `preview.proxy`, not `server.proxy`, so `pnpm build && vite preview`
 * served the app and 404'd every API call. That is a deployment gap, not a product bug, and
 * it is why the first version of "just deploy the web build" could not work.
 *
 * So this is that missing piece, with no dependency beyond Node. It serves the real
 * `apps/web/dist` output -- the same bytes that would be deployed -- and proxies `/api` to
 * the API process. Nothing is stubbed, so a flow that passes here passed against the build.
 *
 * ## WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not add a feature flag, a demo mode, or a fake data path. The preview runs the
 * development release profile because the release profile REFUSES TO START while safety rules
 * are unreviewed -- which is the correct behaviour and must not be worked around. What that
 * means in practice is stated in the startup banner and in `/api/health`, every time.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..');
const WEB_DIST = join(REPO, 'apps', 'web', 'dist');

const PORT = Number(process.env.ASI_PREVIEW_PORT ?? 8080);
const API_ORIGIN = process.env.ASI_API_ORIGIN ?? 'http://127.0.0.1:8787';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve a URL path to a file inside the build directory, or `null`.
 *
 * The traversal guard is the reason this is not three lines of `join()`. `normalize` on a
 * joined path still lets `..` climb out of the root, and a preview server is exactly the
 * thing that should not serve the host filesystem to a browser. Anything that escapes is
 * refused rather than clamped, so a traversal attempt reads as a miss instead of quietly
 * returning some other file.
 */
function resolveStatic(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = resolve(join(WEB_DIST, normalize(decoded)));
  if (candidate !== WEB_DIST && !candidate.startsWith(WEB_DIST + '/')) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

/** Read a request body into a Buffer, with a size cap so a preview cannot be used to fill memory. */
function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error(`request body over ${limitBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.once('end', () => resolve(Buffer.concat(chunks)));
    req.once('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = req.url ?? '/';

    // The API, proxied. Same origin as the page, so the client needs no configuration.
    if (url.startsWith('/api')) {
      /*
       * The request body is BUFFERED, not streamed.
       *
       * Passing the `IncomingMessage` straight through as a fetch body looks like the obvious
       * thing to do and fails every POST: undici requires `duplex: 'half'` for a streaming
       * body, throws without it, and the proxy answers 502. The first version of this file did
       * exactly that, so GETs worked and every write silently failed -- the UI then reported
       * "Location service unavailable" for a request that had never reached the API. The API
       * bodies here are small JSON documents, so buffering costs nothing and removes the
       * requirement entirely.
       */
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const body = hasBody ? await readBody(req) : undefined;

      const upstream = await fetch(API_ORIGIN + url, {
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
        body,
        // A redirect would hide an API misroute behind a 200, so it is disabled deliberately.
        redirect: 'manual',
      });
      const payload = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      res.end(payload);
      return;
    }

    const file = resolveStatic(url);

    if (file) {
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': file.includes('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      createReadStream(file).pipe(res);
      return;
    }

    /*
     * Unknown path -> the app shell.
     *
     * A client-side route reached by refresh or a shared link has no file on disk, so
     * serving 404 there would break every deep link into the app. `index.html` is only
     * returned for paths that look like navigation; a missing ASSET still 404s, because
     * answering a missing .glb with a page of HTML turns a broken mesh into a confusing
     * parse error in the viewer instead of an honest failed request.
     */
    if (extname(url.split('?')[0] ?? '')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    const shell = join(WEB_DIST, 'index.html');
    if (!existsSync(shell)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`No web build at ${WEB_DIST}. Run: pnpm --filter @asi/web build`);
      return;
    }
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    createReadStream(shell).pipe(res);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'preview_bad_gateway', message: e?.message ?? String(e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[preview] web + api on http://127.0.0.1:${PORT}`);
  console.log(`[preview]   serving build: ${WEB_DIST}`);
  console.log(`[preview]   proxying /api -> ${API_ORIGIN}`);
  console.log('[preview] NOT for clinical use. Synthetic data only. Not clinically reviewed.');
});