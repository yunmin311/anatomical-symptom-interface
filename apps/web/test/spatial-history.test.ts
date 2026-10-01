/**
 * The spatial history presentation mapper.
 *
 * These tests used to assert the OPPOSITE of most of what they assert now. The
 * mapper used to group episodes client-side on region + sub-region + side, and
 * the suite was happy with that because the suite was testing the same wrong
 * assumption.
 *
 * A place is (person, region, side, sub-region, quantised point cell). The client
 * knew three of those five, so it merged two places the server had deliberately
 * kept apart — silently undoing a semantic decision that had been made carefully
 * on the storage side and tested there. So the tests below are mostly about what
 * the mapper must NOT do: not regroup, not merge, not recount, not invent.
 *
 * The mapper's real job is small and mostly cosmetic — turn `shoulder.anterior`
 * into "Front of shoulder · left", and order the list — and that is what it is
 * tested for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BodyRegion, SpatialHistoryNode } from '@asi/shared';
import { REGIONS } from '@asi/shared';
import {
  presentSpatialHistory,
  markLabel,
  episodesOf,
} from '../src/ui/spatial-history.ts';

type Overrides = Partial<{
  regionRowId: string;
  region: string;
  side: string;
  subRegionId: string | null;
  point: { x: number; y: number } | null;
  episodeCount: number | null;
  lastEpisodeAt: string | null;
  episodes: SpatialHistoryNode['episodes'];
}>;

/** A node shaped exactly like the server's, with the noisy parts optional. */
function node(over: Overrides = {}): SpatialHistoryNode {
  const regionRowId = over.regionRowId ?? 'r1';
  const startedAt = over.lastEpisodeAt ?? '2026-01-01T00:00:00.000Z';
  const episodes =
    over.episodes === undefined
      ? [
          {
            id: `${regionRowId}-e1`,
            startedAt,
            endedAt: null,
            status: 'open',
            title: 'episode one',
            point: over.point ?? null,
            safetyFlagCount: 0,
            visualSelections: [],
          },
        ]
      : over.episodes;
  return {
    regionRowId,
    region: over.region ?? 'shoulder',
    side: over.side ?? 'left',
    subRegionId: over.subRegionId === undefined ? 'shoulder.anterior' : over.subRegionId,
    point: over.point ?? null,
    // The default count must agree with the episodes it is counting, so a test
    // that forgets to set one is not accidentally asserting a lie.
    episodeCount: over.episodeCount === undefined ? episodes.length : over.episodeCount,
    lastEpisodeAt: startedAt,
    lastTitle: episodes[0]?.title ?? null,
    episodes,
  };
}

function ep(
  id: string,
  startedAt: string,
  point: { x: number; y: number } | null = null,
): SpatialHistoryNode['episodes'][number] {
  return {
    id,
    startedAt,
    endedAt: null,
    status: 'open',
    title: `episode ${id}`,
    point,
    safetyFlagCount: 0,
    visualSelections: [],
  };
}

/* ================================================================== */
/* one node becomes exactly one place                                  */
/* ================================================================== */

test('one server node becomes one mark, with its identity passed through', () => {
  const spatial = presentSpatialHistory([node({ regionRowId: 'abc' })]);
  const shoulder = spatial.regions.find((r) => r.region === 'shoulder')!;
  assert.equal(shoulder.marks.length, 1);
  // The id is the SERVER's row id, not something composed from fields here.
  assert.equal(shoulder.marks[0]!.id, 'abc');
});

test('the mark count is the server count, never a recount of the episodes shown', () => {
  // Three episodes exist, but the per-place limit truncated the list to one. A
  // count taken from `episodes.length` would say 1 and be wrong.
  const spatial = presentSpatialHistory([
    node({ regionRowId: 'busy', episodeCount: 3, episodes: [ep('a', '2026-01-01T00:00:00.000Z')] }),
  ]);
  const mark = spatial.regions[0]!.marks[0]!;
  assert.equal(mark.episodeCount, 3);
  assert.equal(mark.episodes.length, 1);
  assert.equal(spatial.totalEpisodes, 3);
  // And the region total is the server's arithmetic, not the client's.
  assert.equal(spatial.regions[0]!.episodeCount, 3);
});

test('TWO places the server kept apart stay two marks here', () => {
  // Same region, same side, same sub-region. They differ only by the point cell,
  // which is exactly the field the old client grouping ignored.
  const spatial = presentSpatialHistory([
    node({ regionRowId: 'cell-1', point: { x: 0.2, y: 0.3 } }),
    node({ regionRowId: 'cell-2', point: { x: 0.7, y: 0.8 } }),
  ]);
  const marks = spatial.regions[0]!.marks;
  assert.equal(
    marks.length,
    2,
    'the client merged two places the server kept apart; place identity is not the client\'s to decide',
  );
  assert.notEqual(marks[0]!.id, marks[1]!.id);
});

test('left and right are two places, because the server said so', () => {
  const spatial = presentSpatialHistory([
    node({ regionRowId: 'l', side: 'left' }),
    node({ regionRowId: 'r', side: 'right' }),
  ]);
  assert.equal(spatial.regions[0]!.marks.length, 2);
});

test('the mapper never merges nodes that share every field it can see', () => {
  // Even byte-identical apart from the row id, these are two places. Deduping on
  // the visible fields is the same bug with an extra step.
  const spatial = presentSpatialHistory([
    node({ regionRowId: 'x' }),
    node({ regionRowId: 'y' }),
  ]);
  assert.equal(spatial.regions[0]!.marks.length, 2);
});

/* ================================================================== */
/* presentation, which is the part it is allowed to do                */
/* ================================================================== */

test('places are grouped under their region, labelled for a person', () => {
  const spatial = presentSpatialHistory([
    node({ regionRowId: 'a', region: 'shoulder' }),
    node({ regionRowId: 'b', region: 'knee', subRegionId: 'knee.anterior', side: 'right' }),
  ]);
  assert.equal(spatial.totalEpisodes, 2);
  assert.equal(spatial.regions.length, 2);
  const shoulder = spatial.regions.find((r) => r.region === 'shoulder')!;
  assert.equal(shoulder.label, REGIONS.shoulder.label);
  assert.match(shoulder.marks[0]!.label, /Front of shoulder/);
  assert.match(shoulder.marks[0]!.label, /left/, 'the side belongs in the label');
});

test('a place with no sub-region is labelled with its region', () => {
  const spatial = presentSpatialHistory([node({ subRegionId: null })]);
  assert.equal(spatial.regions[0]!.marks[0]!.subRegionId, null);
  assert.equal(spatial.regions[0]!.marks[0]!.label, REGIONS.shoulder.label);
});

test('busiest place leads within a region, then most recent', () => {
  const spatial = presentSpatialHistory([
    node({ regionRowId: 'a1', subRegionId: 'shoulder.anterior', lastEpisodeAt: '2026-09-01T00:00:00.000Z', episodes: [ep('a1', '2026-09-01T00:00:00.000Z'), ep('a2', '2026-01-01T00:00:00.000Z')] }),
    node({ regionRowId: 'b1', subRegionId: 'shoulder.lateral', lastEpisodeAt: '2026-09-02T00:00:00.000Z' }),
  ]);
  const marks = spatial.regions[0]!.marks;
  assert.equal(marks[0]!.id, 'a1', 'the busier place must lead');
  assert.equal(marks[0]!.episodeCount, 2);
  assert.equal(marks[1]!.id, 'b1');
});

test('the most recent episode means latest, not last listed', () => {
  const spatial = presentSpatialHistory([
    node({
      regionRowId: 'r',
      episodes: [
        ep('old', '2026-01-01T00:00:00.000Z'),
        ep('new', '2026-09-01T00:00:00.000Z'),
        ep('mid', '2026-05-01T00:00:00.000Z'),
      ],
    }),
  ]);
  const region = spatial.regions[0]!;
  assert.equal(region.mostRecent?.episodeId, 'new');
  assert.equal(region.mostRecent?.startedAt, '2026-09-01T00:00:00.000Z');
});

test('a place point is passed through, and stays null when there was no pin', () => {
  const withoutPin = presentSpatialHistory([node({ point: null })]);
  assert.equal(withoutPin.regions[0]!.marks[0]!.point, null);
  const withPin = presentSpatialHistory([node({ point: { x: 0.3, y: 0.4 } })]);
  assert.deepEqual(withPin.regions[0]!.marks[0]!.point, { x: 0.3, y: 0.4 });
});

test('each mark carries the server episodes and each episode its OWN point', () => {
  // The aggregate and the per-episode point are different facts. Losing the
  // per-episode one is how a map ends up attributing every episode in a place to
  // the same spot.
  const spatial = presentSpatialHistory([
    node({
      regionRowId: 'r',
      point: { x: 0.5, y: 0.5 },
      episodes: [ep('a', '2026-01-01T00:00:00.000Z', { x: 0.48, y: 0.5 }), ep('b', '2026-02-01T00:00:00.000Z', { x: 0.52, y: 0.5 })],
    }),
  ]);
  const mark = spatial.regions[0]!.marks[0]!;
  assert.deepEqual(mark.point, { x: 0.5, y: 0.5 });
  assert.deepEqual(mark.episodes.map((e) => e.point!.x).sort(), [0.48, 0.52]);
  assert.equal(episodesOf(spatial).length, 2);
});

/* ================================================================== */
/* robustness                                                           */
/* ================================================================== */

test('a region with no history is not a place', () => {
  // The server sends placeholders so the whole body can be drawn. They carry no
  // history, so the index must not list them as somewhere the user has pointed.
  const spatial = presentSpatialHistory([node({ regionRowId: '', episodeCount: 0, episodes: [] })]);
  assert.deepEqual(spatial, { regions: [], totalEpisodes: 0 });
});

test('a place with episodes but no pin still appears', () => {
  // Not being able to place a pin is not the same as having no history, so this
  // must not be filtered out on a null point.
  const spatial = presentSpatialHistory([node({ point: null, episodeCount: 2 })]);
  assert.equal(spatial.regions.length, 1);
  assert.equal(spatial.regions[0]!.marks[0]!.episodeCount, 2);
  assert.equal(spatial.regions[0]!.marks[0]!.point, null);
});

test('a region this build cannot draw is dropped rather than coerced', () => {
  const spatial = presentSpatialHistory([node({ region: 'tail' }), node({ regionRowId: 'ok' })]);
  assert.equal(spatial.regions.length, 1);
  assert.equal(spatial.regions[0]!.region as BodyRegion, 'shoulder');
  // The total counts what is PRESENTED, so it agrees with the sum of the marks on
  // screen. Counting a place the map cannot draw would make the header say 2 over
  // a list of 1 — the same class of quiet disagreement this mapper exists to stop.
  // The server only emits regions from the ontology, so this is a build mismatch
  // rather than something to paper over.
  assert.equal(spatial.totalEpisodes, 1);
  assert.equal(spatial.regions[0]!.episodeCount, 1);
});

test('an unknown sub-region id falls back to the id, not a crash', () => {
  assert.equal(markLabel(node({ subRegionId: 'shoulder.nowhere' })), 'shoulder.nowhere · left');
});

test('empty input is an empty model, not a crash', () => {
  assert.deepEqual(presentSpatialHistory([]), { regions: [], totalEpisodes: 0 });
});

test('the mapper invents no severity, score or trend', () => {
  const spatial = presentSpatialHistory([node()]);
  const serialised = JSON.stringify(spatial).toLowerCase();
  for (const forbidden of ['severity', 'score', 'risk', 'trend', 'diagnos'])
    assert.equal(
      serialised.includes(forbidden),
      false,
      `spatial history must not carry ${forbidden}`,
    );
});