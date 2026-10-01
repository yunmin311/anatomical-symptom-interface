/**
 * Migration 003 — spatial cell on `body_regions`.
 *
 * WHY. `body_regions` is meant to be a derived index of *places*: the rows the
 * personal health map groups by. It had no usable identity, and two defects
 * followed from that.
 *
 * CASE 1 — one place, two rows. `createEpisode` calls `ensureRegion` before the
 * mutations run, so the row is created with `sub_region_id = NULL` and only later
 * updated to the real sub-region. A second episode in the same sub-region then
 * looks for a row with `sub_region_id IS NULL`, does not find the first one
 * (it has since been changed), and creates a second row. Two rows for one place,
 * each counting one episode.
 *
 * CASE 2 — two places, one row. Two episodes in the same region and side, both
 * with no sub-region, share a row. The pin columns are then overwritten by
 * whichever episode wrote last, so one episode's pin silently becomes the other
 * one's and two distinct places are merged.
 *
 * The fix is to give the row a real identity that includes WHERE, not just what
 * region. `point_cell_x` / `point_cell_y` hold the quantised normalised pin. A
 * place is then (person, region, side, sub-region, cell), so:
 *
 *   - the same region/side/sub-region at the same pin aggregates to one place
 *   - clearly different pins land in different cells and cannot overwrite
 *   - two pins within the same cell aggregate, and the rule is explicit and
 *     testable rather than accidental
 *
 * Additive only. Existing rows get NULL cells, which is the honest value for a
 * place whose pin was never recorded, and SQLite's NULL semantics keep every one
 * of them addressable.
 */
export const REGION_CELL_SQL = `
ALTER TABLE body_regions ADD COLUMN point_cell_x INTEGER;
ALTER TABLE body_regions ADD COLUMN point_cell_y INTEGER;
CREATE INDEX IF NOT EXISTS idx_regions_place
  ON body_regions(person_id, region, side, sub_region_id, point_cell_x, point_cell_y);
`;