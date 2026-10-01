/**
 * Spatial history — a PRESENTATION mapper over the server read model.
 *
 * This used to be a second domain schema. The client fetched episodes and grouped
 * them itself, on region + sub-region + side, and the type was called
 * `SpatialHistorySource` with a `FIXTURE_SPATIAL_HISTORY` that said so. That was
 * not a stand-in with the same shape, it was a different ANSWER: a place on the
 * server is (person, region, side, sub-region, quantised point cell), so two
 * episodes a few millimetres apart in one sub-region are two places. Grouping
 * client-side on three fields merged them back into one mark, which meant the
 * browser quietly undid a semantic decision the storage layer had made on purpose
 * and had tested. The two disagreeing definitions were the bug, and the client was
 * the one that was wrong.
 *
 * So the server is the only place identity comes from. This module may sort, label,
 * filter and reshape FOR DISPLAY. It may not regroup, may not recompute a count,
 * and may not decide that two nodes are the same place — `regionRowId` is the
 * identity it is handed and it carries it through untouched.
 *
 * What it is allowed to add is words. A server place says
 * `shoulder.anterior`; a body index says "Front of shoulder · left", which is what
 * a person reads.
 */
import type { BodyRegion, SpatialHistoryNode, SpatialPoint } from '@asi/shared';
import { REGIONS } from '@asi/shared';

/** A place as the index lists it. The server decided what a place is; this says what to call it. */
export interface LocationMark {
  /**
   * The server's place identity, passed through UNCHANGED. Not a label, not a
   * composite of fields — if two marks have the same id they are the same place,
   * and if they differ they are different places whatever their labels say.
   */
  id: string;
  region: BodyRegion;
  subRegionId: string | null;
  side: string;
  label: string;
  /**
   * The server's count, passed through. Never recomputed from the episodes shown:
   * `episodes` may be truncated by the per-place limit, so a count taken from it
   * would quietly disagree with the truth.
   */
  episodeCount: number;
  lastEpisodeAt: string | null;
  /** The place's aggregate point, or null when no episode in it carried a pin. */
  point: SpatialPoint | null;
  /** The episodes behind the count, newest first, possibly truncated server-side. */
  episodes: SpatialHistoryNode['episodes'];
}

export interface RegionHistory {
  region: BodyRegion;
  label: string;
  /** Sum of the server's per-place counts, so a region total is also the server's. */
  episodeCount: number;
  marks: LocationMark[];
  mostRecent: {
    episodeId: string;
    startedAt: string;
    title: string;
    status: string;
  } | null;
}

export interface SpatialHistory {
  regions: RegionHistory[];
  totalEpisodes: number;
}

/**
 * The region a node claims, or null if this build does not have it.
 *
 * A node naming a region the ontology does not define cannot be drawn on a body
 * map, and it must not be forced into one: silently coercing it to a `BodyRegion`
 * would put an unrenderable place on a body the user is looking at.
 */
function regionOf(node: SpatialHistoryNode): BodyRegion | null {
  const region = REGIONS[node.region as BodyRegion];
  return region ? node.region as BodyRegion : null;
}

/**
 * A place's label.
 *
 * Purely a word for a place the server already identified. Uses the same fields
 * the server grouped on so a label cannot imply a grouping the server did not do.
 */
export function markLabel(node: SpatialHistoryNode): string {
  const regionLabel = REGIONS[node.region as BodyRegion]?.label ?? node.region;
  if (!node.subRegionId) return regionLabel;
  const sub = REGIONS[node.region as BodyRegion]?.subRegions.find(
    (s) => s.id === node.subRegionId,
  );
  const where = sub?.label ?? node.subRegionId;
  if (node.side === 'left' || node.side === 'right') return `${where} · ${node.side}`;
  return where;
}

/**
 * Present the server's places. Total and pure: no node shape can make it throw,
 * because a health map has to render even when a record is partial.
 *
 * One `SpatialHistoryNode` becomes exactly one `LocationMark`. There is no merge
 * step and no dedupe step, because both would be places being invented.
 */
export function presentSpatialHistory(nodes: SpatialHistoryNode[]): SpatialHistory {
  const byRegion = new Map<BodyRegion, LocationMark[]>();
  let totalEpisodes = 0;

  for (const node of nodes) {
    // A region the person has never described anything in contributes nothing to
    // history, and `episodeCount === 0` is how the server says so. Filtering on
    // the COUNT rather than on a null point means a place with episodes but no pin
    // still appears: not being able to place a pin is not the same as having no
    // history.
    if (node.episodeCount === 0) continue;
    const region = regionOf(node);
    if (!region) continue;

    const mark: LocationMark = {
      id: node.regionRowId,
      region,
      subRegionId: node.subRegionId,
      side: node.side,
      label: markLabel(node),
      episodeCount: node.episodeCount,
      lastEpisodeAt: node.lastEpisodeAt,
      point: node.point,
      episodes: node.episodes,
    };

    const list = byRegion.get(region);
    if (list) list.push(mark);
    else byRegion.set(region, [mark]);
    totalEpisodes += node.episodeCount;
  }

  const regions: RegionHistory[] = [];
  for (const [region, marks] of byRegion) {
    // Most-visited first, then most recent, so the busiest place leads. Both keys
    // are presentation order and neither changes which places exist.
    const sorted = [...marks].sort((a, b) => {
      if (b.episodeCount !== a.episodeCount) return b.episodeCount - a.episodeCount;
      return (b.lastEpisodeAt ?? '').localeCompare(a.lastEpisodeAt ?? '');
    });
    // The region's most recent episode is the most recent one the SERVER reported,
    // taken from the marks it gave. Not re-derived by re-sorting every episode,
    // which would mean walking records the client was handed a count for instead
    // of the records themselves.
    const newest = sorted
      .flatMap((m) => m.episodes)
      .reduce<LocationMark['episodes'][number] | null>(
        (best, e) => (!best || e.startedAt > best.startedAt ? e : best),
        null,
      );

    regions.push({
      region,
      label: REGIONS[region].label,
      episodeCount: sorted.reduce((sum, m) => sum + m.episodeCount, 0),
      marks: sorted,
      mostRecent: newest
        ? {
            episodeId: newest.id,
            startedAt: newest.startedAt,
            title: newest.title,
            status: newest.status,
          }
        : null,
    });
  }

  regions.sort((a, b) => b.episodeCount - a.episodeCount);
  return { regions, totalEpisodes };
}

/** Every episode the server returned, flattened for a timeline. Order is the server's. */
export function episodesOf(history: SpatialHistory): SpatialHistoryNode['episodes'] {
  return history.regions.flatMap((r) => r.marks.flatMap((m) => m.episodes));
}