import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { env, gate, hasModel, releaseProfile, startupSafetyReport } from './env.ts';

const server = serve({ fetch: app.fetch, port: env.ASI_PORT }, (info) => {
  console.log(`[asi] listening on http://localhost:${info.port}`);
  console.log(`[asi] orchestrator: ${hasModel() ? `model (${env.ASI_MODEL})` : 'deterministic (offline)'}`);
  const report = startupSafetyReport();
  if (report) console.warn(report);
  if (releaseProfile === 'release') {
    console.log(`[asi] release profile active; ${gate.unreviewed} rule(s) still unreviewed.`);
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n[asi] ${sig} — shutting down`);
    server.close(() => process.exit(0));
  });
}
