/**
 * What a 3D pick MEANS, decided without touching any state.
 *
 * This exists because the decision is not a detail of a click handler. A raycast
 * that lands on real geometry resolves to an `asiId`, and turning that into a user
 * action involves three questions that have different answers depending on what was
 * hit: did the user mean an area or a structure, which sub-region (if any) follows
 * from it, and is the surface point a location indication. Getting any of them
 * wrong is a correctness bug that only shows up when a user clicks something, so it
 * is a pure function with its own tests rather than something to re-derive while
 * also mutating state.
 *
 * THE BUG THIS REPLACES. The 3D click handler read `hit.subRegionId` and, if it was
 * absent, did nothing at all. `subRegionId` is only present when a pick has exactly
 * ONE sub-region, which is precisely the case where a structure pick is least
 * interesting. So:
 *
 *   - clicking a structure reachable from several sub-regions did nothing, silently;
 *   - clicking one with a single sub-region set the AREA and never recorded that
 *     the user had pointed at a structure, which is the whole point of the 3D viewer;
 *   - the surface point was discarded, so a click on real mesh never became a pin.
 *
 * And this module does not write. BodyMap applies an intent through the session; the
 * canonical authority for a visual selection stays
 * `location.userSelectedStructureIds`, and this file has no opinion about storage.
 */
import type { MapPoint, PickResult } from './types.ts';
import { resolveSubRegionForStructure } from './scene-manifest.ts';
import type { SubRegionResolution } from './scene-manifest.ts';

/**
 * A pick resolved into an action, with the sub-region consequence decided but not
 * applied.
 *
 * `subRegion` carries the resolution rather than an answer because all three
 * outcomes are legitimate and the caller has to treat them differently. Presenting
 * them as one value would force a choice somewhere, and the choice that gets forced
 * is always "the first one", which is how a structure reachable from the front and
 * the outside of the shoulder ends up recorded as only the front.
 */
export type PickIntent =
  /** Nothing actionable. Includes a pick the contract cannot resolve honestly. */
  | { kind: 'none'; reason: string }
  /**
   * An AREA was pointed at. Follows the existing area-selection workflow: choose the
   * area, never invent a structure selection. A sub-region proxy is a place on the
   * body, not a structure, so recording a structure here would be a fabrication.
   */
  | { kind: 'area'; subRegionId: string; point: MapPoint | null }
  /**
   * A STRUCTURE was pointed at. The caller must visual-select it. `subRegion` says
   * what follows, and `unresolved` explicitly does NOT name one.
   */
  | {
      kind: 'structure';
      structureId: string;
      point: MapPoint | null;
      subRegion: SubRegionResolution;
    };

/**
 * Decide what a pick means.
 *
 * `currentSubRegionId` is the RECORD's value, not a draft, because the rule is about
 * what the user has already said: someone who picked "front of shoulder" and then
 * clicked a deltoid meant that deltoid in the front of the shoulder, not a reset to
 * whichever sub-region the manifest happens to list first.
 *
 * Fails closed in every ambiguous case. A pick with no `structureId` produces no
 * intent rather than a guess, and a structure pick with no `subRegionIds` still
 * produces a structure intent — selecting a structure does not depend on knowing
 * the area, and refusing the whole click would lose the part we are certain about.
 */
export function intentFromPick(hit: PickResult, currentSubRegionId: string | null): PickIntent {
  if (hit.kind === 'none') return { kind: 'none', reason: 'Nothing was hit.' };

  if (hit.kind === 'subregion') {
    // A sub-region entry has exactly one sub-region, so `soleSubRegionId` is always
    // present — `indexScene` refuses an entry that says otherwise. Its absence is
    // therefore a contract violation, and guessing a sub-region here would be
    // putting an arbitrary area on the record.
    if (!hit.subRegionId)
      return {
        kind: 'none',
        reason: 'That area could not be resolved, so nothing was changed.',
      };
    return { kind: 'area', subRegionId: hit.subRegionId, point: hit.point ?? null };
  }

  if (!hit.structureId)
    return {
      kind: 'none',
      reason: 'That structure could not be resolved, so nothing was changed.',
    };

  return {
    kind: 'structure',
    structureId: hit.structureId,
    point: hit.point ?? null,
    // Whole list, never `[0]`. Three outcomes, all of them legitimate.
    subRegion: resolveSubRegionForStructure(hit.subRegionIds ?? [], currentSubRegionId),
  };
}

/**
 * What a pick does to the workbench draft, decided without touching any state.
 *
 * The draft is the area and the point the user has indicated but not yet committed
 * with "Use this location". Staging them — rather than writing them on click — is
 * what makes an unresolved sub-region leave the user with a CHOICE: the confirm
 * button stays disabled until an area exists, instead of a tool picking one and the
 * user not knowing it had.
 *
 * The structure selection is different and is reported separately as
 * `selectStructureId`, because it is immediate and unambiguous. The canonical
 * authority for it is still `location.userSelectedStructureIds`; this only says
 * what should be selected.
 *
 * `subRegionId` is RECONCILED against the candidates for an unresolved pick, not
 * left alone. That is the single most important line in this file, and the rule is
 * three cases rather than one: a draft area the structure can be in is kept, an
 * absent one stays absent, and a draft area it CANNOT be in is cleared. See
 * `draftAreaIsCompatible` for why a stale area is not harmless — it is what the
 * confirm button would submit.
 */
export interface PickDraft {
  subRegionId: string | null;
  point: MapPoint | null;
}

export interface PickDraftEffect {
  /** The draft after the pick. Unchanged fields are carried through as they were. */
  draft: PickDraft;
  /** Set when the pick means "visual-select this structure", immediately. */
  selectStructureId: string | null;
  /** Wording for the live region. */
  announce: string;
}

/**
 * Reduce a pick against the current draft.
 *
 * `recordSubRegionId` is the RECORD's area, deliberately not the draft's: the
 * "keep" rule is about what the user has already told us, and a draft they have not
 * committed is not that.
 */
export function reducePickToDraft(
  intent: PickIntent,
  draft: PickDraft,
  recordSubRegionId: string | null,
): PickDraftEffect {
  if (intent.kind === 'none')
    return { draft, selectStructureId: null, announce: describePick(intent) };

  // A pick with no point keeps the existing draft pin rather than clearing it: a
  // click on geometry that did not resolve a surface position says nothing about
  // where they meant, and dropping a pin they placed would be lossy.
  const point = intent.point ?? draft.point;

  if (intent.kind === 'area')
    return {
      draft: { subRegionId: intent.subRegionId, point },
      selectStructureId: null,
      announce: describePick(intent),
    };

  const label = undefined;
  switch (intent.subRegion.kind) {
    case 'keep':
      return {
        // The SAME id the record already has. "Keep" must never mean "change to
        // something else", and it never means the first of the candidates.
        draft: { subRegionId: recordSubRegionId ?? draft.subRegionId, point },
        selectStructureId: intent.structureId,
        announce: describePick(intent, label),
      };
    case 'use':
      return {
        draft: { subRegionId: intent.subRegion.subRegionId, point },
        selectStructureId: intent.structureId,
        announce: describePick(intent, label),
      };
    case 'unresolved':
      // The structure selection stands because it is certain. The AREA does not, so
      // the draft is reconciled against the candidates: a draft area the structure
      // cannot be in is cleared rather than carried forward, because the confirm
      // button would otherwise submit a location that contradicts the click. See
      // `draftAreaIsCompatible` for why that is not simply "leave it alone".
      return {
        draft: reconcileDraft(draft, intent.subRegion.candidates, intent.point),
        selectStructureId: intent.structureId,
        announce: describePick(intent, label),
      };
  }
}

/**
 * Is a pending draft area still compatible with a structure the user just pointed at?
 *
 * A draft is not persisted truth — nothing has confirmed it — but it IS the thing
 * the "Use this location" button will submit, and that button is gated on the draft
 * having an area at all. So a draft area that the structure cannot be in is not a
 * harmless leftover: it is a submit-able location that contradicts the click the user
 * just made.
 *
 * Concretely: a draft of `shoulder.posterior`, then a click on the deltoid (which is
 * reachable from the anterior and the lateral only). The pick is correctly
 * UNRESOLVED — we will not guess between its two candidates — but carrying
 * `shoulder.posterior` forward would let the user submit "the back of the shoulder,
 * plus the deltoid", which is a record of something they did not indicate.
 *
 * Three cases:
 *
 *   A. no draft area                      -> stays null
 *   B. draft area IS one of the candidates -> kept, still a draft
 *   C. draft area is NOT a candidate       -> cleared, so the user must choose
 *
 * B is safe precisely because the draft is not persisted: it is the user's own
 * pending intent for a sub-region the structure genuinely can be in, and forcing
 * them to re-pick it would be discarding something they already said.
 */
export function draftAreaIsCompatible(
  draftSubRegionId: string | null,
  candidates: string[],
): boolean {
  if (draftSubRegionId === null) return true;
  // A structure with no declared sub-regions constrains nothing, so there is nothing
  // for a draft to be incompatible with.
  if (candidates.length === 0) return true;
  return candidates.includes(draftSubRegionId);
}

/**
 * Bring the draft into line with the structure the user just pointed at.
 *
 * COMPATIBLE DRAFT: kept whole, area and pin both, because the user already said it
 * and the structure genuinely can be there. It stays a DRAFT — nothing is committed
 * here, and the confirm button is still the thing that persists it.
 *
 * INCOMPATIBLE DRAFT: cleared, so the confirm button cannot submit an area the
 * structure cannot be in. The user chooses again from the candidates, which is the
 * one thing a tool must not do on their behalf.
 *
 * AND THE PIN, DELIBERATELY. Clearing an area because it cannot hold the structure
 * has to take the pin that was dropped in that area with it, or the confirm button
 * becomes reachable again with a point from `shoulder.posterior` and no area —
 * a location the user never indicated. The rule is about OWNERSHIP of the pin, not
 * about clearing pins generally:
 *
 *   - a pin that came FROM THIS PICK stays, because it was placed by the click the
 *     user just made;
 *   - a pin that PREDATES the pick is dropped only when the area it belonged to is
 *     the area being invalidated.
 *
 * So a compatible draft keeps both its area and its pin, an incompatible one loses
 * both, and a pick that resolved its own point always keeps that point. Decided here
 * and pinned by tests rather than left to whichever branch ran first.
 */
function reconcileDraft(
  draft: PickDraft,
  candidates: string[],
  pickPoint: MapPoint | null,
): PickDraft {
  if (draftAreaIsCompatible(draft.subRegionId, candidates))
    return { subRegionId: draft.subRegionId, point: pickPoint ?? draft.point };

  // The draft area cannot hold this structure. Its pin goes with it; a point from
  // this very pick survives, because it describes the structure, not the old area.
  return { subRegionId: null, point: pickPoint };
}

/**
 * Whether the PICK was unresolved — the structure is reachable from several
 * sub-regions and nothing about the click narrowed it.
 *
 * That is not the same as "the user must choose an area": the pending draft may
 * already hold a sub-region the structure genuinely can be in, which is case B of
 * `draftAreaIsCompatible`. This reports the pick; `reducePickToDraft` decides what
 * the draft ends up holding.
 */
export function needsAreaChoice(intent: PickIntent): boolean {
  return intent.kind === 'structure' && intent.subRegion.kind === 'unresolved';
}

/**
 * Human wording for an intent, for the live region.
 *
 * `structureLabel` is the domain's `layTerm`, which is nullish for a structure
 * nobody has written plain language for yet — a real and common state while
 * `layTerm` coverage is incomplete, so it degrades to no label rather than to a
 * blank space in a sentence.
 *
 * Deliberately says "pointed at" / "indicated" and never "confirmed" or anything
 * clinical. A visual selection records where someone pointed, and the sentence that
 * describes it is the last place that wording could drift into a claim about their
 * body.
 */
export function describePick(
  intent: PickIntent,
  structureLabel?: string | null,
): string {
  switch (intent.kind) {
    case 'none':
      return intent.reason;
    case 'area':
      return `${intent.subRegionId} selected. Indicate a structure here if you want to point at one.`;
    case 'structure': {
      const what = structureLabel ? ` ${structureLabel}` : '';
      switch (intent.subRegion.kind) {
        case 'keep':
          return `You pointed at${what} in ${intent.subRegion.subRegionId}.`;
        case 'use':
          return `You pointed at${what}, set to ${intent.subRegion.subRegionId}.`;
        case 'unresolved':
          return intent.subRegion.candidates.length
            ? `You pointed at${what}. Choose an area — it can be reached from ${intent.subRegion.candidates.length} places.`
            : `You pointed at${what}. Choose an area.`;
      }
    }
  }
}