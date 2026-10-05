/**
 * Geometry fidelity policy.
 *
 * ## The constraint this exists to enforce
 *
 * The shoulder geometry is BodyParts3D 4.0's 99%-polygon-reduction package. It is
 * approved for regional localisation, layer and system exploration, structure
 * selection and contextual viewing. It is NOT approved for surgical-grade,
 * microscopic, or high-magnification insertion/origin inspection, because at
 * close range the reduction is plainly visible: flat facets across muscle
 * bellies, and torn boundaries where the reducer cut geometry.
 *
 * The isolated supraspinatus is the proof. At whole-shoulder framing it reads as
 * a clean muscle; framed on itself it is 878 triangles and the facets and the
 * frayed insertion are obvious.
 *
 * So the viewer refuses to let the product present an extreme close-up as though
 * the source supported fine inspection. It does this by CLAMPING the orbit
 * distance, not by hiding geometry.
 *
 * ## What this must never do
 *
 * Smooth, subdivide, remesh or otherwise "fix" the geometry to make close-ups
 * look better. That would invent anatomy the source does not contain, and it
 * would do it invisibly. A viewer that makes the data look better than it is has
 * made the data worse for a health product.
 */

export interface FidelityPolicy {
  /** Orbit distance the camera may not go below. */
  minDistance: number;
  /** Below this, the close-inspection band begins and the notice should show. */
  cautionDistance: number;
  /** Radius used to derive the limits for a region. */
  regionRadius: number;
  /** One line, plain language, describing what this source can and cannot show. */
  notice: string;
  /** What the geometry is approved for. */
  approvedFor: readonly string[];
  /** What it is explicitly not approved for. */
  notApprovedFor: readonly string[];
}

export const DEFAULT_NOTICE =
  'This is a 99%-reduced anatomical model. It shows where things are and how they ' +
  'relate. It is not detailed enough to inspect fine structure closely.';

export const APPROVED_FOR = [
  'regional anatomical localisation',
  'layer and system exploration',
  'structure selection',
  'contextual anatomy viewing',
] as const;

export const NOT_APPROVED_FOR = [
  'surgical-grade anatomy',
  'microscopic or fine anatomy',
  'high-magnification inspection of origins and insertions',
] as const;

/**
 * Derive the limits for a region.
 *
 * `regionRadius` is the radius of the region being viewed. The floor is a small
 * fraction of it: close enough to read one structure's shape and boundaries,
 * far enough that a single reduced mesh is not magnified into its own facets.
 */
export function fidelityPolicy(regionRadius: number): FidelityPolicy {
  const r = Math.max(regionRadius, 1e-6);
  return {
    minDistance: r * 0.16,
    cautionDistance: r * 0.34,
    regionRadius: r,
    notice: DEFAULT_NOTICE,
    approvedFor: APPROVED_FOR,
    notApprovedFor: NOT_APPROVED_FOR,
  };
}

/** Clamp a requested orbit distance into the permitted range. */
export function clampDistance(policy: FidelityPolicy, requested: number): number {
  if (!Number.isFinite(requested)) return policy.regionRadius;
  return Math.max(policy.minDistance, requested);
}

/**
 * True when the camera has entered the band where the source's limits show.
 * The UI shows the notice here rather than hiding anything.
 */
export function inCloseInspectionBand(policy: FidelityPolicy, distance: number): boolean {
  return distance <= policy.cautionDistance;
}