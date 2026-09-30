/**
 * Environment. Fail fast on anything unsafe, degrade gracefully on anything
 * optional. The service must be runnable with zero configuration.
 */
import { z } from 'zod';
import type { ReleaseProfile } from '@asi/shared';
import { releaseReady, unreviewedRuleCount } from '@asi/shared';

const EnvSchema = z.object({
  ASI_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ASI_DB_PATH: z.string().default('./data/asi.sqlite'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ASI_MODEL: z.string().default('claude-sonnet-5'),
  ASI_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /**
   * 'development' surfaces explicitly unreviewed prototype rules, labelled as
   * such. 'release' withholds any rule that has not completed clinical review
   * and blocks the record instead of hiding the signal. See ADR 0003.
   */
  ASI_RELEASE_PROFILE: z.enum(['development', 'release']).default('development'),
});

export const env = EnvSchema.parse({
  ASI_PORT: process.env.ASI_PORT,
  ASI_DB_PATH: process.env.ASI_DB_PATH,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ASI_MODEL: process.env.ASI_MODEL,
  ASI_LOG_LEVEL: process.env.ASI_LOG_LEVEL,
  ASI_RELEASE_PROFILE: process.env.ASI_RELEASE_PROFILE,
});

export const releaseProfile: ReleaseProfile = env.ASI_RELEASE_PROFILE;

/**
 * A release build is only honest if it can actually release. If the profile says
 * 'release' but time-critical rules are unreviewed, refuse to start rather than
 * quietly serving a product that cannot show a safety signal it knows about.
 */
export const gate = releaseReady();

if (releaseProfile === 'release' && !gate.ready) {
  throw new Error(
    `[asi] REFUSING TO START in the release profile. ${gate.blocking.length} urgent/emergency ` +
      `safety rule(s) have not completed clinical review: ${gate.blocking.join(', ')}. ` +
      `Starting would mean a record could silently omit a safety signal it matched. ` +
      `Either complete clinical review, or run with ASI_RELEASE_PROFILE=development, ` +
      `which labels every unreviewed rule as a prototype.`,
  );
}

/** Whether a model is available. Not a hard requirement: everything works offline. */
export const hasModel = (): boolean => Boolean(env.ANTHROPIC_API_KEY);

export function startupSafetyReport(): string | null {
  if (releaseProfile === 'release' && gate.ready) return null;
  const lines = [
    `[asi] release profile: ${releaseProfile}`,
    `[asi] ${unreviewedRuleCount()} of ${gate.unreviewed} safety rules are NOT clinically reviewed` +
      (gate.blocking.length ? ` (${gate.blocking.length} of them urgent/emergency: ${gate.blocking.join(', ')})` : ''),
  ];
  if (releaseProfile === 'development') {
    lines.push(
      '[asi] Development build. Unreviewed rules ARE shown to the user and are labelled unreviewed in the UI.',
      '[asi] Do not point this at real users.',
    );
  }
  return lines.join('\n');
}
