import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BodyRegion, Episode } from '@asi/shared';
import { emptyRecord, REGIONS } from '@asi/shared';
import {
  DERIVED_SPATIAL_HISTORY,
  FIXTURE_SPATIAL_HISTORY,
  buildSpatialHistory,
} from '../src/ui/spatial-history.ts';

type Overrides = Partial<{
  region: BodyRegion;
  subRegionId: string | null;
  side: Episode['side'];
  startedAt: string;
  phrase: string | null;
  point: { x: number; y: number } | null;
}>;

/** A minimal but schema-shaped episode; no domain factory is needed or wanted. */
function episode(id: string, overrides: Overrides = {}): Episode {
  const region = overrides.region ?? 'shoulder';
  const base = emptyRecord(region);
  const record = {
    ...base,
    location: {
      ...base.location,
      region,
      subRegionId:
        overrides.subRegionId === undefined
          ? 'shoulder.anterior'
          : overrides.subRegionId,
      side: overrides.side ?? 'left',
      userPhrase: overrides.phrase === undefined ? 'it ached' : overrides.phrase,
      point: overrides.point ?? null,
    },
  };
  return {
    id,
    personId: 'local',
    region,
    side: overrides.side ?? 'left',
    status: 'open',
    startedAt: overrides.startedAt ?? '2026-01-01T00:00:00.000Z',
    title: `episode ${id}`,
    record,
    provenance: {},
    createdAt: overrides.startedAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.startedAt ?? '2026-01-01T00:00:00.000Z',
    safetyFlags: [],
  };
}

test('history is grouped by region, not listed flat', () => {
  const spatial = buildSpatialHistory([
    episode('a', { region: 'shoulder' }),
    episode('b', { region: 'shoulder' }),
    episode('c', { region: 'knee' }),
  ]);
  assert.equal(spatial.totalEpisodes, 3);
  assert.equal(spatial.regions.length, 2);
  assert.equal(spatial.regions[0]?.region, 'shoulder');
  assert.equal(spatial.regions[0]?.episodeCount, 2);
  assert.equal(spatial.regions[0]?.label, REGIONS.shoulder.label);
});

test('each place becomes a mark with its own count', () => {
  const spatial = buildSpatialHistory([
    episode('a', { subRegionId: 'shoulder.anterior', side: 'left' }),
    episode('b', { subRegionId: 'shoulder.anterior', side: 'left' }),
    episode('c', { subRegionId: 'shoulder.lateral', side: 'left' }),
  ]);
  const shoulder = spatial.regions.find((r) => r.region === 'shoulder')!;
  assert.equal(shoulder.marks.length, 2, 'two distinct places');
  const anterior = shoulder.marks.find((m) => m.subRegionId === 'shoulder.anterior')!;
  assert.equal(anterior.episodeCount, 2);
  assert.match(anterior.label, /Front of shoulder/);
  assert.match(anterior.label, /left/, 'side belongs in the label');
});

test('the same sub-region on opposite sides is two different places', () => {
  const spatial = buildSpatialHistory([
    episode('l', { subRegionId: 'shoulder.anterior', side: 'left' }),
    episode('r', { subRegionId: 'shoulder.anterior', side: 'right' }),
  ]);
  const marks = spatial.regions[0]!.marks;
  assert.equal(marks.length, 2, 'left and right must not collapse into one mark');
});

test('the most recent episode means latest, not last fetched', () => {
  const spatial = buildSpatialHistory([
    episode('old', { startedAt: '2026-01-01T00:00:00.000Z' }),
    episode('new', { startedAt: '2026-09-01T00:00:00.000Z' }),
    episode('mid', { startedAt: '2026-05-01T00:00:00.000Z' }),
  ]);
  const region = spatial.regions[0]!;
  assert.equal(region.mostRecent?.episodeId, 'new');
  assert.equal(region.mostRecent?.startedAt, '2026-09-01T00:00:00.000Z');
  // And the mark's own last-seen date agrees.
  assert.equal(region.marks[0]?.lastEpisodeAt, '2026-09-01T00:00:00.000Z');
});

test('busiest place leads within a region', () => {
  const spatial = buildSpatialHistory([
    episode('a1', { subRegionId: 'shoulder.anterior', startedAt: '2026-09-01T00:00:00.000Z' }),
    episode('a2', { subRegionId: 'shoulder.anterior', startedAt: '2026-01-01T00:00:00.000Z' }),
    episode('a3', { subRegionId: 'shoulder.anterior', startedAt: '2026-02-01T00:00:00.000Z' }),
    episode('b1', { subRegionId: 'shoulder.lateral', startedAt: '2026-09-02T00:00:00.000Z' }),
  ]);
  const marks = spatial.regions[0]!.marks;
  assert.equal(marks[0]?.subRegionId, 'shoulder.anterior');
  assert.equal(marks[0]?.episodeCount, 3);
  assert.equal(marks[1]?.subRegionId, 'shoulder.lateral');
});

test('a mark has no point unless an episode actually carried a pin', () => {
  const withoutPin = buildSpatialHistory([episode('a', { point: null })]);
  assert.equal(withoutPin.regions[0]?.marks[0]?.point, null);
  const withPin = buildSpatialHistory([episode('b', { point: { x: 0.3, y: 0.4 } })]);
  assert.deepEqual(withPin.regions[0]?.marks[0]?.point, { x: 0.3, y: 0.4 });
});

test('a pin on any episode places a shared mark', () => {
  const spatial = buildSpatialHistory([
    episode('a', { point: null }),
    episode('b', { point: { x: 0.5, y: 0.5 } }),
  ]);
  assert.equal(spatial.regions[0]?.marks.length, 1);
  assert.deepEqual(spatial.regions[0]?.marks[0]?.point, { x: 0.5, y: 0.5 });
});

test('an unspecified sub-region still yields a usable mark', () => {
  const spatial = buildSpatialHistory([episode('a', { subRegionId: null })]);
  const mark = spatial.regions[0]?.marks[0];
  assert.ok(mark);
  assert.equal(mark?.subRegionId, null);
  assert.equal(mark?.label, REGIONS.shoulder.label);
});

test('empty history is an empty model, not a crash', () => {
  const spatial = buildSpatialHistory([]);
  assert.deepEqual(spatial, { regions: [], totalEpisodes: 0 });
});

test('the read model invents no severity, score or trend', () => {
  const spatial = buildSpatialHistory([episode('a')]);
  const serialised = JSON.stringify(spatial).toLowerCase();
  for (const forbidden of ['severity', 'score', 'risk', 'trend', 'diagnos'])
    assert.equal(
      serialised.includes(forbidden),
      false,
      `spatial history must not carry ${forbidden}`,
    );
});

test('the fixture source is labelled, and reads the same as the derived one', () => {
  assert.equal(FIXTURE_SPATIAL_HISTORY.kind, 'fixture');
  assert.match(FIXTURE_SPATIAL_HISTORY.disclaimer ?? '', /stand-in/i);
  assert.equal(DERIVED_SPATIAL_HISTORY.kind, 'derived');
  assert.equal(DERIVED_SPATIAL_HISTORY.disclaimer, null);
  const episodes = [episode('a')];
  assert.deepEqual(
    FIXTURE_SPATIAL_HISTORY.load(episodes),
    DERIVED_SPATIAL_HISTORY.load(episodes),
  );
});
