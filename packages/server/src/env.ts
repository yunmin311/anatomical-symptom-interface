/**
 * Environment. Fail fast on anything unsafe, degrade gracefully on anything
 * optional. The service must be runnable with zero configuration.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  ASI_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ASI_DB_PATH: z.string().default('./data/asi.sqlite'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ASI_MODEL: z.string().default('claude-sonnet-5'),
  ASI_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const env = EnvSchema.parse({
  ASI_PORT: process.env.ASI_PORT,
  ASI_DB_PATH: process.env.ASI_DB_PATH,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ASI_MODEL: process.env.ASI_MODEL,
  ASI_LOG_LEVEL: process.env.ASI_LOG_LEVEL,
});

/**
 * Whether a model is available. Deliberately not a hard requirement: grounding,
 * interview, red flags and summary generation all work fully offline.
 */
export const hasModel = (): boolean => Boolean(env.ANTHROPIC_API_KEY);
