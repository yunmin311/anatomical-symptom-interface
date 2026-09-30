/**
 * Spatial history read model.
 *
 * The personal anatomical health map currently groups by `body_regions` row and
 * returns a count. That is enough to list places, not enough to draw a body, and
 * it leaves the frontend to fetch every episode and work out the geometry itself.
 *
 * This is the server-side read model. It answers "where has this person's body
 * been sore, and what happened each time" in one request, so the client never
 * scans episodes to recompute it.
 *
 * WHAT THIS IS NOT. This is a location history, not a risk map. Episode count at
 * a point is how OFTEN something was described there. It carries no severity, no
 * clinical weighting and no inference about cause, and nothing here should ever
 * be rendered as "you are at higher risk of X". A body map that shades by
 * frequency invites exactly that reading, so the shape of this read model keeps
 * counts and episodes separable from any judgement about them: the count is
 * alongside the episodes, never merged into a score, and the field is named
 * `episodeCount` rather than anything implying severity.
 */
import { get, all } from '../db/client.ts';
import { REGIONS, getStructure } from '@asi/shared';
import type { BodyRegion } from '@asi/shared';

export interface SpatialEpisodeRef {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  /** The episode's own title, already a short human phrase. */
  title: string;
  /** Safety flags raised on this episode, so a marker can show it without a fetch. */
  safetyFlagCount: number;
  /** Structures the user pointed at, as labels. Location, not findings. */
  visualSelections: string[];
}

export interface SpatialHistoryNode {
  /** Stable per-place identity, for keying and for "go to this place". */
  regionRowId: string;
  region: string;
  side: string;
  subRegionId: string | null;
  /** Normalised 0..1 on the body map. Null when the user never placed a pin. */
  point: { x: number; y: number } | null;
  episodeCount: number;
  lastEpisodeAt: string | null;
  lastTitle: string | null;
  /** Newest first. The episodes behind the count, so the client need not scan. */
  episodes: SpatialEpisodeRef[];
}

interface EpisodeRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  title: string;
  record_json: string;
}

/**
 * Everything that has ever been described in one place, keyed by place.
 *
 * `limitPerPlace` bounds the episode list per place so a person with fifty
 * episodes in one spot does not ship fifty summaries to render a map. The count
 * is always the true total, never the length of the truncated list -- a map that
 * showed "3" because it only loaded 3 would be quietly lying.
 */
export function spatialHistory(personId: string, limitPerPlace = 20): SpatialHistoryNode[] {
  const places = all(
    `SELECT id, region, side, sub_region_id, point_x, point_y
       FROM body_regions
      WHERE person_id = ?
      ORDER BY updated_at DESC`,
    personId,
  );

  return places.map((p) => {
    const regionRowId = String(p.id);
    const episodes = all(
      `SELECT id, started_at, ended_at, status, title, record_json
         FROM episodes
        WHERE region_id = ?
        ORDER BY started_at DESC
        LIMIT ?`,
      regionRowId,
      limitPerPlace,
    ) as unknown as EpisodeRow[];

    const total = Number(
      (get<{ c: number }>(`SELECT COUNT(*) AS c FROM episodes WHERE region_id = ?`, regionRowId)?.c ?? 0),
    );

    const refs: SpatialEpisodeRef[] = episodes.map((e) => {
      let selections: string[] = [];
      try {
        const record = JSON.parse(e.record_json) as {
          location?: { userSelectedStructureIds?: string[] };
        };
        selections = record.location?.userSelectedStructureIds ?? [];
      } catch {
        // A record projection that will not parse is a bug, but it must not take
        // the whole health map down with it. The episode still appears.
        selections = [];
      }
      return {
        id: e.id,
        startedAt: e.started_at,
        endedAt: e.ended_at,
        status: e.status,
        title: e.title,
        safetyFlagCount: Number(
          (get<{ c: number }>(`SELECT COUNT(*) AS c FROM safety_flags WHERE episode_id = ?`, e.id)?.c ?? 0),
        ),
        // Labels, not ids: the map draws words, and the id stays the identity.
        visualSelections: selections.map((id) => getStructure(id)?.label ?? id),
      };
    });

    const newest = refs[0] ?? null;

    return {
      regionRowId,
      region: String(p.region),
      side: String(p.side),
      subRegionId: (p.sub_region_id as string | null) ?? null,
      point: p.point_x != null && p.point_y != null
        ? { x: Number(p.point_x), y: Number(p.point_y) }
        : null,
      episodeCount: total,
      lastEpisodeAt: newest ? newest.startedAt : null,
      lastTitle: newest ? newest.title : null,
      episodes: refs,
    };
  });
}

/**
 * Every place for a person, including the four V1 regions they have never
 * described anything in.
 *
 * The map has to draw the whole body, so a region with no episodes has to come
 * back as an empty node rather than being absent. An absent region is a region
 * the client has to special-case, and a client that special-cases it will
 * eventually special-case it wrongly.
 */
export function spatialHistoryWithEmptyRegions(personId: string, limitPerPlace = 20): SpatialHistoryNode[] {
  const existing = spatialHistory(personId, limitPerPlace);
  const seen = new Set(existing.map((n) => `${n.region}|${n.side}`));

  const placeholders: SpatialHistoryNode[] = [];
  for (const region of Object.keys(REGIONS) as BodyRegion[]) {
    for (const side of ['left', 'right'] as const) {
      if (seen.has(`${region}|${side}`)) continue;
      placeholders.push({
        regionRowId: '',
        region,
        side,
        subRegionId: null,
        point: null,
        episodeCount: 0,
        lastEpisodeAt: null,
        lastTitle: null,
        episodes: [],
      });
    }
  }
  return [...existing, ...placeholders];
}
