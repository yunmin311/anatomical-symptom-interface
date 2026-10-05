/**
 * Presentation material system for the anatomy atlas.
 *
 * ## What this is, and what it is not
 *
 * A structure's SYSTEM decides which anatomical material family it is drawn
 * with. That is presentation metadata. It must never stand in for anatomical
 * identity: the identity is the FMA concept, the anatomical name, and the
 * provenance record, and those are carried untouched in the manifest. Changing
 * a colour here changes how a structure is *shown*, nothing about what it *is*.
 *
 * ## Why adjacent structures are not all identical
 *
 * A system family is one material family, but the source models each structure
 * as its own mesh. Drawing 27 muscles in exactly one flat colour produces the
 * "grey blob" failure the whole project exists to fix, just in colour. Adjacent
 * structures in the same system therefore get small, deterministic variations in
 * lightness and saturation so that boundaries read.
 *
 * The variation is DETERMINISTIC: derived from the structure's own id, so the
 * same structure is the same shade on every load, on every machine, and in every
 * screenshot. It is emphatically not a random rainbow -- variation is a few
 * percent, within one family, and never crosses into another system's hue.
 *
 * ## Selection is a separate state
 *
 * Selection is not a material in this table. It is applied as an overlay state
 * so that "selected" cannot be confused with "this tissue is red". A selected
 * structure never means abnormal, inflamed, injured or clinically significant.
 */

/** The tissue systems the viewer can present. Mirrors the derived system map. */
export const SYSTEMS = [
  'bone',
  'cartilage',
  'muscle',
  'fascia',
  'tendon',
  'ligament',
  'nerve',
  'artery',
  'vein',
  'skin',
  'gland',
  'organ',
] as const;

export type System = (typeof SYSTEMS)[number];

/**
 * Base colour per system, in sRGB, chosen to match the palette the Blender
 * geometry gate was judged against.
 *
 * Muscle is a dull red-brown on purpose. A vivid red muscle in a health product
 * reads as inflammation, and nothing in this product is inflamed.
 */
export const SYSTEM_BASE: Readonly<Record<System, string>> = {
  bone: '#f4efe0',
  cartilage: '#d3e0e6',
  muscle: '#b0705f',
  fascia: '#e8e0d4',
  tendon: '#ece3cd',
  ligament: '#e6dcc4',
  nerve: '#e8c65a',
  artery: '#cf4a45',
  vein: '#3f5f9e',
  skin: '#e0b39a',
  gland: '#d09aa4',
  organ: '#cfa79c',
};

/** Human-facing group name. Never implies a clinical state. */
export const SYSTEM_LABEL: Readonly<Record<System, string>> = {
  bone: 'Bone',
  cartilage: 'Cartilage',
  muscle: 'Muscle',
  fascia: 'Fascia',
  tendon: 'Tendon',
  ligament: 'Ligament',
  nerve: 'Nerve',
  artery: 'Artery',
  vein: 'Vein',
  skin: 'Skin',
  gland: 'Gland',
  organ: 'Organ',
};

/**
 * How far a structure may drift from its system colour.
 *
 * Small on purpose. Enough for adjacent muscles to separate, not enough for the
 * family to stop reading as one family. Expressed as fractions applied in HSL.
 *
 * `saturation` is a CEILING, scaled down per colour by the chroma actually
 * available. Measured over 48,000 samples, applying the full saturation swing
 * unconditionally pushed bone's saturation out by 0.149 against a nominal 0.09:
 * bone is a near-white, and HSL saturation is numerically hypersensitive when
 * chroma is tiny, so 8-bit output quantisation dominates. Bone also cannot
 * meaningfully vary in saturation -- there is almost none to vary. Scaling by
 * chroma fixes both the number and the appearance.
 */
export const VARIATION = {
  /** +/- this fraction of lightness. */
  lightness: 0.055,
  /** Ceiling for the saturation swing, scaled by available chroma. */
  saturation: 0.09,
  /** Chroma at or above which the full saturation swing is allowed. */
  saturationChromaFull: 0.35,
} as const;

/** The selection overlay colour. Deliberately outside every anatomical hue. */
export const SELECTION_COLOUR = '#5cf2ff';
/** Softer companion for the ghost context left behind by isolate. */
export const GHOST_OPACITY = 0.13;
/**
 * Drawn for a structure with no tissue classification.
 *
 * A desaturated slate, deliberately dull so it reads as "not classified" rather
 * than as another tissue. A structure the ontology cannot type is shown as
 * unclassified, never quietly folded into a neighbouring system.
 */
export const UNKNOWN_COLOUR = '#6d7176';

/* ------------------------------------------------------------------ colour */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return { r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m };
}

/* ------------------------------------------------------- stable variation */

/**
 * FNV-1a over the structure id.
 *
 * Used ONLY to spread shades within a family, never to classify anything. The
 * classification is `system`, which comes from the reviewed anatomy-system-map.
 */
export function stableHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stable value in [0,1) for a structure id and a channel name. */
export function stableUnit(id: string, channel: string): number {
  return stableHash(`${id}:${channel}`) / 0x100000000;
}

/**
 * The colour one structure is drawn with: its system family, nudged
 * deterministically so neighbouring structures separate.
 *
 * Same id always yields the same colour. Different systems never share a hue.
 */
export function structureColour(id: string, system: System): string {
  const base = SYSTEM_BASE[system];
  if (!base) return '#808080';
  const rgb = hexToRgb(base);
  const hsl = rgbToHsl(rgb);

  // Chroma is how much colour there is to vary. A near-white has almost none, so
  // it takes lightness variation only; a saturated artery can take both.
  const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
  const satScale = Math.min(1, chroma / VARIATION.saturationChromaFull);

  const dl = (stableUnit(id, 'l') * 2 - 1) * VARIATION.lightness;
  const ds = (stableUnit(id, 's') * 2 - 1) * VARIATION.saturation * satScale;

  return rgbToHex(
    hslToRgb({
      h: hsl.h,
      s: clamp01(hsl.s + ds),
      l: clamp01(hsl.l + dl),
    }),
  );
}

/**
 * The full presentation record for one structure. Kept as data so the renderer
 * has nothing to decide and the tests have something to assert on.
 */
export interface StructurePresentation {
  id: string;
  system: System;
  label: string;
  colour: string;
  /** True when the colour came from a review override rather than the derivation. */
  classificationOverridden: boolean;
  /** Presentation classification: evidence_supported | machine_derived | ... */
  presentationSystemClassification: string;
  /** Ontology verification, tracked separately and never inferred from the above. */
  ontologyFmaVerification: string;
}

export function presentationFor(
  s: {
    id: string;
    label: string;
    /**
     * The presented system, or the literal 'UNKNOWN'.
     *
     * UNKNOWN is a real state, not a type error: a structure whose ontology
     * states no tissue keeps it, and must be drawn as unclassified rather than
     * quietly promoted into some system's material.
     */
    system: System | 'UNKNOWN';
    derivedClass?: string | null;
    presentationSystemClassification?: string | null;
    ontologyFmaVerification?: string | null;
  },
): StructurePresentation {
  const unknown = s.system === 'UNKNOWN';
  return {
    id: s.id,
    // Kept as UNKNOWN so downstream code cannot mistake it for a real system.
    system: s.system as System,
    label: s.label,
    colour: unknown ? UNKNOWN_COLOUR : structureColour(s.id, s.system as System),
    classificationOverridden: Boolean(s.derivedClass && s.derivedClass !== s.system),
    presentationSystemClassification:
      s.presentationSystemClassification ?? (unknown ? 'unknown' : 'machine_derived'),
    ontologyFmaVerification: s.ontologyFmaVerification ?? 'pending_human_review',
  };
}