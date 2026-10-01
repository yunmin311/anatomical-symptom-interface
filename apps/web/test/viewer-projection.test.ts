/**
 * Transition tests for the viewer projection.
 *
 * Every case here is a TRANSITION, not a single point state, and every assertion
 * is read from the RENDERER's own state rather than from the source adapter.
 * Checking `anatomy.getState()` would only prove the source is right; the bug
 * this file exists for is the source being right while the canvas disagrees.
 */
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { TISSUE_LAYER_ORDER } from '@asi/shared';
import type { TissueLayer, ViewerState } from '@asi/shared';
import type { AnatomyAdapter } from '../src/anatomy/types.ts';
import { FIXTURE_MANIFEST } from '../src/anatomy/fixture-manifest.ts';
import { Svg2dAnatomyAdapter } from '../src/anatomy/svg2d.ts';
import { Three3dAnatomyAdapter } from '../src/anatomy/three3d.ts';
import { AnatomyWorkspace } from '../src/anatomy/workspace.ts';

/** Minimal stand-in for the three.js renderer, so a viewer can mount headlessly. */
function stubRenderer() {
  const domElement = {
    style: {} as Record<string, string>,
    width: 640,
    height: 480,
    getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) as DOMRect,
    addEventListener: () => {},
    removeEventListener: () => {},
    remove: () => {},
  };
  return {
    domElement,
    setPixelRatio: () => {},
    setSize: () => {},
    render: () => {},
    dispose: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Minimal stand-in for the host element. */
function stubHost(): HTMLElement {
  return {
    appendChild: () => {},
    style: {} as Record<string, string>,
    isConnected: true,
    clientWidth: 640,
    clientHeight: 480,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) as DOMRect,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function makeRenderer(t: TestContext): Promise<Three3dAnatomyAdapter> {
  const adapter = new Three3dAnatomyAdapter({
    manifest: FIXTURE_MANIFEST,
    rendererFactory: stubRenderer,
  });
  await adapter.mount(stubHost());
  assert.equal(adapter.isLive(), true, 'renderer must be live for these tests to mean anything');
  // The render loop is a timer when headless, so it must be stopped or the test
  // runner never exits.
  t.after(() => adapter.dispose());
  return adapter;
}

/**
 * A workspace wired source -> renderer, plus both ends so a test can assert on
 * the source and the renderer side by side.
 */
async function makeProjection(t: TestContext) {
  const source: AnatomyAdapter & { dispose?: () => void } = new Svg2dAnatomyAdapter();
  let renderer: Three3dAnatomyAdapter | null = null;
  const workspace = new AnatomyWorkspace(source, {
    manifest: FIXTURE_MANIFEST,
    createViewer: async (host) => {
      renderer = await makeRenderer(t);
      void host;
      return renderer;
    },
  });
  await workspace.start(stubHost());
  assert.equal(workspace.getStatus().mode, '3d', 'projection harness must be on 3D');
  t.after(() => {
    workspace.dispose();
    source.dispose?.();
  });
  return {
    source,
    workspace,
    /** The renderer's real state, not the source's. */
    renderer: (): Three3dAnatomyAdapter => {
      assert.ok(renderer, 'renderer was not created');
      return renderer!;
    },
  };
}

const DEEP_ONLY: TissueLayer[] = ['bone', 'joint', 'nerve', 'vessel', 'ligament'];
const SUPERFICIAL_ONLY: TissueLayer[] = ['skin', 'subcutaneous', 'fascia'];

function assertExactLayers(actual: TissueLayer[], expected: TissueLayer[], label: string) {
  const missing = expected.filter((l) => !actual.includes(l));
  const extra = actual.filter((l) => !expected.includes(l));
  assert.deepEqual(missing, [], `${label}: expected layers missing`);
  assert.deepEqual(extra, [], `${label}: stale layers still present`);
}

/* ------------------------------------------------------------------ *
 * A. all layers -> deep
 * ------------------------------------------------------------------ */
test('A. renderer drops superficial layers when the source moves to deep', async (t) => {
  const p = await makeProjection(t);
  // The renderer starts from every layer, which is what made the additive
  // projection invisible: nothing ever had to remove anything.
  assert.deepEqual(
    [...p.renderer().getState().visibleLayers].sort(),
    [...TISSUE_LAYER_ORDER].sort(),
    'renderer must start with every layer',
  );

  p.source.apply({ type: 'setDepth', depth: 'deep' });

  const state = p.renderer().getState();
  for (const layer of SUPERFICIAL_ONLY)
    assert.equal(state.visibleLayers.includes(layer), false, `stale layer ${layer} still shown`);
  for (const layer of DEEP_ONLY)
    assert.equal(state.visibleLayers.includes(layer), true, `deep layer ${layer} missing`);
});

/* ------------------------------------------------------------------ *
 * B. deep -> superficial
 * ------------------------------------------------------------------ */
test('B. renderer drops deep-only layers when the source moves to superficial', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'setDepth', depth: 'deep' });
  assert.ok(p.renderer().getState().visibleLayers.includes('bone'));

  p.source.apply({ type: 'setDepth', depth: 'superficial' });

  const state = p.renderer().getState();
  for (const layer of DEEP_ONLY)
    assert.equal(
      state.visibleLayers.includes(layer),
      false,
      `deep-only layer ${layer} survived a move to superficial`,
    );
  assertExactLayers(state.visibleLayers, ['skin', 'subcutaneous', 'fascia'], 'superficial');
});

test('B2. renderer returns to every layer when the source returns to unknown', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'setDepth', depth: 'deep' });
  p.source.apply({ type: 'setDepth', depth: 'unknown' });
  assertExactLayers(
    p.renderer().getState().visibleLayers,
    [...TISSUE_LAYER_ORDER],
    'unknown depth',
  );
});

/* ------------------------------------------------------------------ *
 * C. select -> deselect
 * ------------------------------------------------------------------ */
test('C. deselecting removes the structure from the renderer, not just the record', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'focusRegion', region: 'shoulder' });
  p.source.apply({
    type: 'highlight',
    structureIds: ['asi:shoulder.deltoid'],
    as: 'candidate',
  });
  p.source.apply({
    type: 'highlight',
    structureIds: ['asi:shoulder.deltoid'],
    as: 'selected',
  });
  assert.deepEqual(p.renderer().getState().selectedStructureIds, ['asi:shoulder.deltoid']);

  // The deselect path: the record's canonical set loses the id, and the viewer
  // is told to match. Mirrors what session.deselect does.
  p.source.apply({ type: 'setSelected', structureIds: [] });

  const state = p.renderer().getState();
  assert.deepEqual(state.selectedStructureIds, [], 'renderer still holds the deselected id');
  // Deselect must be reversible in the viewer too: the structure leaves the
  // selected set and becomes pickable again, so a select -> deselect -> select
  // round trip is not lossy. (Whether the RECORD keeps the candidate is the
  // domain's invariant, covered in session-logic.test.ts; here the question is
  // only what the renderer is left holding.)
  assert.equal(
    p
      .renderer()
      .pickableStructures()
      .some((s) => s.id === 'asi:shoulder.deltoid'),
    true,
    'a deselected structure must be offered again',
  );
  // And when the source re-declares it as a candidate, the renderer shows it.
  p.source.apply({ type: 'setHighlighted', structureIds: ['asi:shoulder.deltoid'] });
  assert.deepEqual(
    p.renderer().getState().highlightedStructureIds,
    ['asi:shoulder.deltoid'],
    'the renderer did not pick the re-declared candidate back up',
  );
});

/* ------------------------------------------------------------------ *
 * D. reject -> unreject
 * ------------------------------------------------------------------ */
test('D. unrejecting removes the rejection from the renderer', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'focusRegion', region: 'shoulder' });
  p.source.apply({ type: 'reject', structureIds: ['asi:shoulder.acromion'] });
  assert.deepEqual(p.renderer().getState().rejectedStructureIds, ['asi:shoulder.acromion']);

  p.source.apply({ type: 'clearReject', structureIds: ['asi:shoulder.acromion'] });

  assert.deepEqual(
    p.renderer().getState().rejectedStructureIds,
    [],
    'renderer still holds a cleared rejection',
  );
});

test('D2. a structure that is still rejected is not offered as pickable', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'focusRegion', region: 'shoulder' });
  p.source.apply({ type: 'reject', structureIds: ['asi:shoulder.deltoid'] });
  const whileRejected = p
    .renderer()
    .pickableStructures()
    .some((s) => s.id === 'asi:shoulder.deltoid');
  assert.equal(whileRejected, false, 'a rejected structure must leave the pickable set');
  p.source.apply({ type: 'clearReject', structureIds: ['asi:shoulder.deltoid'] });
  const afterClear = p
    .renderer()
    .pickableStructures()
    .some((s) => s.id === 'asi:shoulder.deltoid');
  assert.equal(afterClear, true, 'clearing the rejection must bring it back');
});

/* ------------------------------------------------------------------ *
 * E. candidates removed from the source
 * ------------------------------------------------------------------ */
test('E. a highlight the source dropped does not linger in the renderer', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'focusRegion', region: 'knee' });
  p.source.apply({
    type: 'setHighlighted',
    structureIds: ['asi:knee.patella', 'asi:knee.patellar-tendon'],
  });
  assert.equal(p.renderer().getState().highlightedStructureIds.length, 2);

  // The source's candidate set is replaced with just one of them. The renderer
  // has to lose the other, which an additive highlight can never do.
  p.source.apply({ type: 'setHighlighted', structureIds: ['asi:knee.patella'] });

  assert.deepEqual(
    p.renderer().getState().highlightedStructureIds,
    ['asi:knee.patella'],
    'renderer kept a highlight the source no longer has',
  );
});

test('E2. the workspace re-projects exactly on every source change', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'focusRegion', region: 'knee' });
  p.source.apply({
    type: 'highlight',
    structureIds: ['asi:knee.patella', 'asi:knee.patellar-tendon'],
    as: 'candidate',
  });
  // Deselect a DIFFERENT structure, which must not disturb the candidates, and
  // the renderer must still equal the source exactly afterwards.
  p.source.apply({ type: 'setSelected', structureIds: ['asi:knee.patella'] });

  const source = p.source.getState();
  const renderer = p.renderer().getState();
  assert.deepEqual(renderer.selectedStructureIds, source.selectedStructureIds);
  assert.deepEqual(renderer.highlightedStructureIds, source.highlightedStructureIds);
  assert.deepEqual(renderer.rejectedStructureIds, source.rejectedStructureIds);
  assert.deepEqual(renderer.visibleLayers, source.visibleLayers);
});

/* ------------------------------------------------------------------ *
 * F. pins
 * ------------------------------------------------------------------ */
test('F. a cleared pin is not still drawn by the renderer', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'dropPin', point: { x: 0.4, y: 0.6 } });
  assert.deepEqual(p.renderer().getState().activePin, { x: 0.4, y: 0.6 });

  // The source clears it. removePin nulls activePin, and the projection has to
  // carry that null across rather than leaving the marker where it was.
  p.source.apply({ type: 'removePin', pinId: 'any' });
  assert.equal(p.renderer().getState().activePin, null, 'renderer kept a cleared pin');
});

test('F2. a moved pin is reflected in the renderer, not accumulated', async (t) => {
  const p = await makeProjection(t);
  p.source.apply({ type: 'dropPin', point: { x: 0.1, y: 0.1 } });
  p.source.apply({ type: 'movePin', point: { x: 0.8, y: 0.9 } });
  assert.deepEqual(p.renderer().getState().activePin, { x: 0.8, y: 0.9 });
  const pins = p.renderer().getState().pins;
  assert.equal(pins.length, 0, 'movePin must not leave a stale saved pin behind');
});

/* ------------------------------------------------------------------ *
 * The projection is exact, not merely a superset
 * ------------------------------------------------------------------ */
test('renderer state EQUALS source state after a long mixed sequence', async (t) => {
  const p = await makeProjection(t);
  const steps: (() => void)[] = [
    () => p.source.apply({ type: 'focusRegion', region: 'shoulder' }),
    () =>
      p.source.apply({
        type: 'highlight',
        structureIds: ['asi:shoulder.deltoid', 'asi:shoulder.acromion'],
        as: 'candidate',
      }),
    () => p.source.apply({ type: 'setSelected', structureIds: ['asi:shoulder.deltoid'] }),
    () => p.source.apply({ type: 'setDepth', depth: 'deep' }),
    () => p.source.apply({ type: 'reject', structureIds: ['asi:shoulder.acromion'] }),
    () => p.source.apply({ type: 'setSelected', structureIds: [] }),
    () => p.source.apply({ type: 'clearReject', structureIds: ['asi:shoulder.acromion'] }),
    () => p.source.apply({ type: 'dropPin', point: { x: 0.3, y: 0.3 } }),
    () => p.source.apply({ type: 'removePin', pinId: 'any' }),
    () => p.source.apply({ type: 'setDepth', depth: 'superficial' }),
  ];
  for (const step of steps) {
    step();
    const source = p.source.getState();
    const renderer = p.renderer().getState();
    // Equality, checked field by field so a failure says which one drifted.
    assert.deepEqual(renderer.visibleLayers, source.visibleLayers, 'visibleLayers drifted');
    assert.deepEqual(
      renderer.selectedStructureIds,
      source.selectedStructureIds,
      'selectedStructureIds drifted',
    );
    assert.deepEqual(
      renderer.highlightedStructureIds,
      source.highlightedStructureIds,
      'highlightedStructureIds drifted',
    );
    assert.deepEqual(
      renderer.rejectedStructureIds,
      source.rejectedStructureIds,
      'rejectedStructureIds drifted',
    );
    assert.deepEqual(renderer.activePin, source.activePin, 'activePin drifted');
    assert.deepEqual(renderer.pins, source.pins, 'pins drifted');
  }
});

test('projectState replaces rather than merges, and does not rebuild the renderer', async (t) => {
  const adapter = await makeRenderer(t);
  const before = adapter.getState();
  adapter.projectState({
    ...before,
    visibleLayers: ['bone'],
    selectedStructureIds: ['asi:shoulder.acromion'],
    highlightedStructureIds: [],
    rejectedStructureIds: ['asi:shoulder.deltoid'],
    activePin: null,
  });
  const after = adapter.getState();
  assert.deepEqual(after.visibleLayers, ['bone']);
  assert.deepEqual(after.selectedStructureIds, ['asi:shoulder.acromion']);
  assert.deepEqual(after.rejectedStructureIds, ['asi:shoulder.deltoid']);
  // Still live and still the same instance: no renderer was recreated.
  assert.equal(adapter.isLive(), true);
});

test('setSelected replaces rather than accumulating', () => {
  const adapter = new Svg2dAnatomyAdapter();
  adapter.apply({ type: 'setSelected', structureIds: ['a', 'b'] });
  adapter.apply({ type: 'setSelected', structureIds: ['b'] });
  assert.deepEqual(adapter.getState().selectedStructureIds, ['b']);
  adapter.apply({ type: 'setSelected', structureIds: [] });
  assert.deepEqual(adapter.getState().selectedStructureIds, []);
});

test('setSelected withdraws a conflicting highlight or rejection', () => {
  const adapter = new Svg2dAnatomyAdapter();
  adapter.apply({ type: 'highlight', structureIds: ['x'], as: 'candidate' });
  adapter.apply({ type: 'setSelected', structureIds: ['x'] });
  assert.deepEqual(
    adapter.getState().highlightedStructureIds,
    [],
    'a selected structure must not also read as a bare candidate',
  );
});
