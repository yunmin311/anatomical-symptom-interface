import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { env, hasModel } from './env.ts';
import { unreviewedRuleCount } from '@asi/shared';

const server = serve({ fetch: app.fetch, port: env.ASI_PORT }, (info) => {
  console.log(`[asi] listening on http://localhost:${info.port}`);
  console.log(`[asi] orchestrator: ${hasModel() ? `model (${env.ASI_MODEL})` : 'deterministic (offline)'}`);
  const unreviewed = unreviewedRuleCount();
  if (unreviewed > 0) {
    console.warn(
      `[asi] WARNING: ${unreviewed} red-flag rule(s) are not clinically reviewed. ` +
        `This build is for development only — do not point it at real users.`,
    );
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n[asi] ${sig} — shutting down`);
    server.close(() => process.exit(0));
  });
}
