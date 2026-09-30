/**
 * Spatial history read model — the frontend consumption boundary.
 *
 * The long-term idea is "the body is the index to personal history": body region
 * -> location marks -> episode count -> most recent episode -> inspect. That
 * needs a read model the UI can render without knowing how episodes are stored.
 *
 * This is a CONSUMPTION BOUNDARY, not a second domain schema. It is derived
 * client-side from the episodes the API already returns, it adds no persisted
 * field, and nothing here may be treated as authoritative. When the main agent
 * lands the real spatial read model, this file is replaced by a fetch of it and
 * the components below do not change: that is the whole point of putting the
 * seam here rather than letting the components reach into the episode list.
 *
 * Deliberately not modelled: severity, risk, scores or trends. A count is a
 * count of records. The domain has no clinical severity per episode and this
 * layer must not invent one.
 */
import type { BodyRegion, Episode } from '@asi/shared';
import { REGIONS } from '@asi/shared';

/** A remembered place on the body, aggregated across episodes. */
export interface LocationMark {
  /**
   * Region plus sub-region plus side. Never a bare region: "shoulder" alone
   * cannot place anything, and a body index with no marks is a list.
   */
  id: string;
  region: BodyRegion;
  subRegionId: string | null;
  side: string;
  label: string;
  /** Episodes that recorded this place. */
  episodeCount: number;
  lastEpisodeAt: string | null;
  /**
   * Normalised point, when the episode carried a pin. Optional on purpose: most
   * records have no pin, and inventing one would place a mark the user never
   * indicated.
   */
  point: { x: number; y: number } | null;
}

export interface RegionHistory {
  region: BodyRegion;
  label: string;
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

function markId(episode: Episode): string {
  // `region` and `side` are the episode's own projection of the record; prefer
  // them so this layer reads the same values the rest of the UI does.
  const subRegionId = episode.record.location.subRegionId ?? null;
  return `${episode.region}:${subRegionId ?? 'unspecified'}:${episode.side}`;
}

function markLabel(episode: Episode): string {
  const subRegionId = episode.record.location.subRegionId;
  const regionLabel = REGIONS[episode.region]?.label ?? episode.region;
  if (!subRegionId) return regionLabel;
  const sub = REGIONS[episode.region]?.subRegions.find((s) => s.id === subRegionId);
  const where = sub?.label ?? subRegionId;
  if (episode.side === 'left' || episode.side === 'right') return `${where} · ${episode.side}`;
  return where;
}

/**
 * Derive the spatial read model from episodes. Pure and total: no episode shape
 * can make it throw, because history must still render when a record is partial.
 */
export function buildSpatialHistory(episodes: Episode[]): SpatialHistory {
  const byRegion = new Map<BodyRegion, Map<string, LocationMark>>();

  for (const episode of episodes) {
    const region = episode.region;
    if (!REGIONS[region]) continue;
    let marks = byRegion.get(region);
    if (!marks) {
      marks = new Map();
      byRegion.set(region, marks);
    }
    const id = markId(episode);
    const startedAt = episode.startedAt ?? null;
    const existing = marks.get(id);
    if (existing) {
      existing.episodeCount += 1;
      // Keep the newest timestamp rather than the last one seen: episodes are
      // not guaranteed to arrive in date order, and "last episode" must mean
      // latest, not most-recently-fetched.
      if (
        startedAt &&
        (!existing.lastEpisodeAt || startedAt > existing.lastEpisodeAt)
      )
        existing.lastEpisodeAt = startedAt;
      // A pin on any episode for this place is enough to place the mark.
      if (!existing.point && episode.record.location.point)
        existing.point = { ...episode.record.location.point };
      continue;
    }
    marks.set(id, {
      id,
      region,
      subRegionId: episode.record.location.subRegionId ?? null,
      side: episode.side,
      label: markLabel(episode),
      episodeCount: 1,
      lastEpisodeAt: startedAt,
      point: episode.record.location.point
        ? { ...episode.record.location.point }
        : null,
    });
  }

  const regions: RegionHistory[] = [];
  for (const [region, marks] of byRegion) {
    const list = [...marks.values()].sort((a, b) => {
      // Most-visited first, then most recent, so the busiest place leads.
      if (b.episodeCount !== a.episodeCount) return b.episodeCount - a.episodeCount;
      return (b.lastEpisodeAt ?? '').localeCompare(a.lastEpisodeAt ?? '');
    });
    const regionEpisodes = episodes
      .filter((e) => e.region === region)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    const newest = regionEpisodes[0];
    regions.push({
      region,
      label: REGIONS[region].label,
      episodeCount: regionEpisodes.length,
      marks: list,
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
  return { regions, totalEpisodes: episodes.length };
}

/**
 * Fixture adapter.
 *
 * The main agent is building the real spatial read model. Until it lands this
 * stands in for it so the UI can be built and tested against a stable shape. It
 * is clearly labelled as a fixture and is never used to invent history: it only
 * reshapes episodes that already exist.
 */
export interface SpatialHistorySource {
  readonly kind: 'derived' | 'fixture';
  readonly disclaimer: string | null;
  load(episodes: Episode[]): SpatialHistory;
}

export const DERIVED_SPATIAL_HISTORY: SpatialHistorySource = {
  kind: 'derived',
  disclaimer: null,
  load: buildSpatialHistory,
};

export const FIXTURE_SPATIAL_HISTORY: SpatialHistorySource = {
  kind: 'fixture',
  disclaimer:
    'Spatial history is currently derived on the client. The grouped body index is a stand-in until the server read model lands.',
  load: buildSpatialHistory,
};
