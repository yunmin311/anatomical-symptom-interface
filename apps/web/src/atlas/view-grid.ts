/**
 * The 2D locator map's hit grid.
 *
 * Cells carry the SAME BodyParts3D ids the 3D viewer uses, so a tap on the 2D map
 * selects the identical structure in 3D. One identity, two surfaces.
 */

export interface ViewGrid {
  schemaVersion: number;
  view: string;
  layer: string;
  grid: { w: number; h: number };
  /** False when the layer draws only skin, which is context and not selectable. */
  selectable: boolean;
  structures: string[];
  /** Per row: [startX, length, structureIndex] runs into structures[]. */
  rows: [number, number, number][][];
}

/**
 * Expand the run-length grid into a row-major table of structure ids.
 *
 * The stored form is [startX, length, structureIndex] runs because the raw grid
 * was 3.4 MB for sixteen files: every one of 32000 cells carried a twelve
 * character string, and most of the grid is empty. Runs bring that to 80 KB.
 */
export function decodeGrid(g: ViewGrid): string[][] {
  const out: string[][] = [];
  for (let y = 0; y < g.grid.h; y++) {
    const row = new Array<string>(g.grid.w).fill('');
    for (const [startX, length, structureIndex] of g.rows[y] ?? []) {
      const id = g.structures[structureIndex];
      if (id === undefined) continue;
      for (let x = startX; x < startX + length && x < g.grid.w; x++) {
        row[x] = id;
      }
    }
    out.push(row);
  }
  return out;
}

/**
 * Which structure is under a normalised point in the image.
 *
 * Returns undefined for empty space, which is a real answer: the map is scoped to
 * the shoulder, so most of the canvas is legitimately outside the anatomy. The
 * caller has to decide what that means rather than being handed a null selection.
 */
export function idAt(g: ViewGrid, cellX: number, cellY: number): string | undefined {
  if (cellX < 0 || cellY < 0 || cellX >= g.grid.w || cellY >= g.grid.h) return undefined;
  const runs = g.rows[cellY];
  if (!runs) return undefined;
  for (const [startX, length, structureIndex] of runs) {
    if (cellX >= startX && cellX < startX + length) return g.structures[structureIndex];
  }
  return undefined;
}

/**
 * Map a click inside the displayed image element to a grid cell.
 *
 * The image is square and the grid is 160x200, so the cell is not the same fraction
 * of width and height. Assuming it is would bias every tap toward the top.
 */
export function cellFromPoint(
  g: ViewGrid,
  offsetX: number,
  offsetY: number,
  boxW: number,
  boxH: number,
): { x: number; y: number } {
  const fx = boxW > 0 ? offsetX / boxW : 0;
  const fy = boxH > 0 ? offsetY / boxH : 0;
  return {
    x: Math.min(g.grid.w - 1, Math.max(0, Math.floor(fx * g.grid.w))),
    y: Math.min(g.grid.h - 1, Math.max(0, Math.floor(fy * g.grid.h))),
  };
}