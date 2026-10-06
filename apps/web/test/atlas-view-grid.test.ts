import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { decodeGrid, type ViewGrid } from '../src/atlas/view-grid.ts';

// Resolved from this file rather than process.cwd(), because the test runner's
// working directory is apps/web and the generated assets live at the repo root.
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VIEWS_DIR = join(REPO, 'assets', 'anatomy', 'generated', 'views');

/**
 * The ATLAS manifest, not the canonical one.
 *
 * These hit maps carry `bp3d:FJ####` ids, which exist only in the atlas contract.
 * `assets/anatomy/generated/shoulder/right/manifest.json` is the canonical
 * AssetManifest and describes `asi:*` structures; reading `.structures` from it
 * returned undefined, and the whole file died on the first access.
 *
 * That is the split working as intended rather than a broken test: the 2D map and
 * the 3D scene are atlas products, so they are checked against the atlas manifest.
 */
const ATLAS_MANIFEST = join(REPO, 'assets', 'anatomy', 'atlas', 'shoulder', 'right', 'atlas-manifest.json');

const VIEWS = ['front', 'back', 'left', 'right'] as const;
const LAYERS = ['surface', 'bone', 'muscle', 'vascular'] as const;

const atlas = JSON.parse(readFileSync(ATLAS_MANIFEST, 'utf8')) as {
  structures: { id: string; canonicalAsiId: string | null; symptomRecordSelectable: boolean }[];
};

const knownIds = new Set(atlas.structures.map((s) => s.id));

describe('2D view hit maps', () => {
  for (const view of VIEWS) {
    for (const layer of LAYERS) {
      const file = join(VIEWS_DIR, `shoulder-${view}-${layer}.grid.json`);

      it(`${view}/${layer} decodes and only ever names a 3D structure`, () => {
        assert.ok(existsSync(file), `${file} is missing; re-run derive-2d-views.py`);

        const raw = JSON.parse(readFileSync(file, 'utf8')) as ViewGrid;
        const grid = decodeGrid(raw);

        assert.equal(grid.length, raw.grid.h, 'row count must match the declared height');
        for (const row of grid) assert.equal(row.length, raw.grid.w, 'every row must be grid.w wide');

// The whole point of deriving the 2D map from the same source: a tap here
        // must select something the 3D viewer can also select. Skin is the one
        // documented exception -- it is loaded as a whole-body context shell and
        // is not in the atlas manifest -- so it is dropped rather than selectable.
        const named = new Set(grid.flat().filter(Boolean));
        for (const id of named) {
          assert.ok(knownIds.has(id), `${id} is in the 2D hit map but not the atlas manifest`);
        }

        const filled = grid.flat().filter(Boolean).length;
        assert.equal(raw.selectable, filled > 0, 'selectable must agree with the decoded cell count');
      });
    }
  }

  it('a tapped 2D cell resolves to a structure that may be written to a record, or not', () => {
    // The 2D map is a presentation surface, so it may show structures with no
    // canonical identity. What it must never do is imply that tapping one produced
    // something recordable. Carrying the crosswalk here makes that checkable
    // per-cell rather than only in the atlas contract test.
    const grid = decodeGrid(
      JSON.parse(readFileSync(join(VIEWS_DIR, 'shoulder-front-muscle.grid.json'), 'utf8')) as ViewGrid,
    );
    const byId = new Map(atlas.structures.map((s) => [s.id, s]));
    const tapped = [...new Set(grid.flat().filter(Boolean))];
    assert.ok(tapped.length > 0, 'the muscle layer resolved no structures at all');

    for (const id of tapped) {
      const s = byId.get(id);
      assert.ok(s, `${id} is not in the atlas manifest`);
      if (s.symptomRecordSelectable) {
        assert.ok(
          s.canonicalAsiId !== null,
          `${id} is selectable but names no canonical asi structure, so a tap could not become a record`,
        );
      }
    }
  });

  it('a deep layer is never silently empty', () => {
    // Guards the failure that actually happened: the hit map resolved to nothing
    // because an orthographic ray was built from the camera's right/up offsets
    // instead of pointing along its forward axis, and the resulting PNG looked
    // fine, so nothing objected.
    for (const view of VIEWS) {
      for (const layer of ['bone', 'muscle', 'vascular'] as const) {
        const grid = decodeGrid(
          JSON.parse(readFileSync(join(VIEWS_DIR, `shoulder-${view}-${layer}.grid.json`), 'utf8')) as ViewGrid,
        );
        const distinct = new Set(grid.flat().filter(Boolean));
        assert.ok(
          distinct.size > 0,
          `${view}/${layer} has an empty hit map, which means the derivation is broken rather than blank`,
        );
      }
    }
  });

  it('the front and back of a muscle map are not the same picture', () => {
    // Front and back were 676 cells each in an early run, which is suspicious: the
    // two sides resolve different structures. Comparing the decoded content, not
    // the cell count, because equal counts can still be different maps.
    const f = decodeGrid(
      JSON.parse(readFileSync(join(VIEWS_DIR, 'shoulder-front-muscle.grid.json'), 'utf8')) as ViewGrid,
    );
    const b = decodeGrid(
      JSON.parse(readFileSync(join(VIEWS_DIR, 'shoulder-back-muscle.grid.json'), 'utf8')) as ViewGrid,
    );
    const fSet = new Set(f.flat().filter(Boolean));
    const bSet = new Set(b.flat().filter(Boolean));
    const onlyFront = [...fSet].filter((id) => !bSet.has(id));
    const onlyBack = [...bSet].filter((id) => !fSet.has(id));
    assert.ok(onlyFront.length > 0, 'front and back resolve an identical structure set');
    assert.ok(onlyBack.length > 0, 'front and back resolve an identical structure set');
  });
});
