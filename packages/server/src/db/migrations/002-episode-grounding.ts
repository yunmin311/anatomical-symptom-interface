/**
 * Migration 002 -- grounding outcome columns on `episodes`.
 *
 * The v1 shape recorded only `grounding_score`, which could not distinguish a
 * grounded episode from a refused one, nor record WHY, nor who said so. v2 added
 * the refusal state so an unsupported complaint stays auditable in the record
 * rather than being inferred from its absence, and carried the orchestrator
 * attribution alongside it, because a refusal that does not say whether offline
 * rules or a model produced it is not auditable either.
 *
 * Written as four additive `ALTER TABLE ... ADD COLUMN` steps, which is the
 * whole reason this project now has a migration runner. Under the old policy a
 * schema change meant dropping every table, and a refused episode's audit trail
 * went with it.
 *
 * `grounding_status` gets a NOT NULL DEFAULT so existing rows backfill to
 * 'grounded' rather than becoming NULL, which would make the interview's refusal
 * check ambiguous.
 */
export const EPISODE_GROUNDING_SQL = `
ALTER TABLE episodes ADD COLUMN grounding_status TEXT NOT NULL DEFAULT 'grounded';
ALTER TABLE episodes ADD COLUMN grounding_reason TEXT;
ALTER TABLE episodes ADD COLUMN grounding_by TEXT;
ALTER TABLE episodes ADD COLUMN grounding_clarification TEXT;
`;
