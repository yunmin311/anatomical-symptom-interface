/**
 * Dataset coverage: what this source provides, and what it does not.
 *
 * ## Why this is a first-class concept and not a missing feature
 *
 * BodyParts3D 4.0 has no shoulder nerves, tendons, ligaments or cartilage. That
 * is a property of the DATASET, not of human anatomy: the brachial plexus, the
 * axillary nerve, the rotator cuff tendons and the glenohumeral ligaments all
 * exist and matter. A layer panel that simply omits them teaches the user that
 * those tissues are absent from the shoulder, which is false.
 *
 * So the panel states both halves explicitly and in source-coverage language:
 * what IS in this model, and what is NOT in this model. The wording never claims
 * anything about the body.
 *
 * Everything here is derived from counts taken from the source tables, not typed
 * in from memory. `systemMeshCount` is the number of meshes the whole-body
 * archive contains for that system.
 */

export type CoverageState = 'available' | 'not-in-source';

export interface SystemCoverage {
  system: string;
  label: string;
  state: CoverageState;
  /** Meshes of this system in the shoulder set shown by this viewer. */
  structuresInRegion: number;
  /** Meshes of this system in the WHOLE-BODY archive. Region 0 means none anywhere. */
  systemMeshCount: number;
  /**
   * Why it is absent, in source terms. Present only when state is
   * 'not-in-source'. Must describe the DATASET, never the body.
   */
  reason?: string;
}

/**
 * Whole-body mesh counts per system, measured from the source archive.
 *
 * These are the numbers that make "not in this model" honest rather than
 * decorative: nerve has 42 meshes in the entire body, and none of them are in the
 * shoulder, which is a different and much more specific statement than "we did
 * not load nerves".
 */
export const WHOLE_BODY_SYSTEM_COUNTS: Readonly<Record<string, number>> = {
  artery: 621,
  vein: 384,
  muscle: 409,
  bone: 204,
  cartilage: 51,
  nerve: 42,
  ligament: 20,
  gland: 11,
  tendon: 8,
  fascia: 4,
  skin: 3,
  organ: 462,
};

export const SHOULDER_SYSTEM_COUNTS: Readonly<Record<string, number>> = {
  bone: 3,
  muscle: 27,
  artery: 7,
  vein: 5,
  skin: 1,
};

/**
 * Why each layer is absent from the shoulder, stated about the model.
 *
 * Checked against the measured counts above: every one of these has a non-zero
 * whole-body count and a zero shoulder count, so the absence is specific to the
 * region rather than the system being unimplemented anywhere.
 */
export const NOT_IN_SOURCE_REASONS: Readonly<Record<string, string>> = {
  nerve:
    'This model has 42 nerve meshes for the whole body and none for the shoulder. ' +
    'There is no brachial plexus, axillary nerve or suprascapular nerve here.',
  tendon:
    'This model has 8 tendons for the whole body and none for the shoulder. ' +
    'The rotator cuff tendons are not present.',
  ligament:
    'This model has 20 ligaments for the whole body and none for the shoulder. ' +
    'The glenohumeral and coracohumeral ligaments are not present.',
  cartilage:
    'This model has 51 cartilages for the whole body and none for the shoulder.',
};

export interface CoverageReport {
  available: SystemCoverage[];
  notInSource: SystemCoverage[];
  /** Every system the viewer knows about, in display order. */
  all: SystemCoverage[];
}

export function coverageForRegion(
  label: string,
  presentSystems: readonly string[],
): CoverageReport {
  const all = Object.keys(WHOLE_BODY_SYSTEM_COUNTS)
    .concat(Object.keys(NOT_IN_SOURCE_REASONS))
    .filter((s, i, arr) => arr.indexOf(s) === i);

  const allCov: SystemCoverage[] = all.map((system) => {
    const inRegion = presentSystems.includes(system);
    return {
      system,
      label,
      state: inRegion ? 'available' : 'not-in-source',
      structuresInRegion: inRegion ? (SHOULDER_SYSTEM_COUNTS[system] ?? 0) : 0,
      systemMeshCount: WHOLE_BODY_SYSTEM_COUNTS[system] ?? 0,
      ...(inRegion ? {} : { reason: NOT_IN_SOURCE_REASONS[system] ?? 'Not present in this model.' }),
    };
  });

  return {
    available: allCov.filter((c) => c.state === 'available'),
    notInSource: allCov.filter((c) => c.state === 'not-in-source'),
    all: allCov,
  };
}

/**
 * Sanity check on the coverage claims themselves.
 *
 * A "not in source" claim is only honest if the system exists SOMEWHERE in the
 * model. If a system's whole-body count is zero, saying it is "not in this model"
 * would quietly imply it does not exist in anatomy at all, which is exactly the
 * confusion this module exists to prevent.
 */
export function coverageClaimsAreHonest(report: CoverageReport): string[] {
  const problems: string[] = [];
  for (const c of report.notInSource) {
    if (c.systemMeshCount === 0) {
      problems.push(
        `"${c.system}" is reported as not-in-source but has 0 meshes in the whole-body ` +
          `model, so the wording implies it does not exist in anatomy. Either load it or ` +
          `reword.`,
      );
    }
  }
  return problems;
}

/** Plain-language sentence for the panel. Describes the model, not the body. */
export function coverageSentence(c: SystemCoverage): string {
  return c.state === 'available'
    ? `${c.structuresInRegion} structure${c.structuresInRegion === 1 ? '' : 's'} in this model for the shoulder.`
    : `Not present in this model for the shoulder. This model has ${c.systemMeshCount} elsewhere in the body.`;
}