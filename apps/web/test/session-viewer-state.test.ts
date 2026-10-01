/**
 * Session-level viewer state: reset and re-localisation.
 *
 * These target the real store, not the adapter in isolation. The bug they cover
 * was never in the adapters' command handling — both handled every command
 * correctly. It was that `reset()` only moved the camera and `describe()` only
 * ADDED candidates, so a new episode inherited the previous one's visual state.
 * A test on the adapter alone would have passed throughout.
 *
 * The requirement is that the ADAPTER's own state is correct, not that the
 * React component happens to hide it, so these assert on `anatomy.getState()`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TISSUE_LAYER_ORDER } from '@asi/shared';
import { anatomy, useSession } from '../src/state/session.ts';

/**
 * A grounded localisation response.
 *
 * Shaped like the wire response rather than the applied result, because this is
 * what the store actually receives and passes to `applyLocalisation`.
 */
function groundedResponse(
  region: string,
  subRegionId: string,
  considered: string[],
): Record<string, unknown> {
  return {
    status: 'grounded',
    region,
    side: 'left',
    depth: 'deep',
    suggestedSubRegionId: subRegionId,
    consideredStructures: considered.map((structureId) => ({
      structureId,
      label: structureId,
      confidence: 0.7,
      evidence: null,
      layer: 'muscle',
      subRegionId,
      source: 'ai_inference',
    })),
    userPhrase: 'it hurts here',
    clarificationQuestion: null,
    by: 'deterministic',
  };
}

/** Point the store's fetch at a canned localisation, or restore it. */
function stubLocalise(response: unknown): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test.beforeEach(() => {
  const store = useSession.getState();
  store.reset();
});

test('reset clears the previous episode selection, candidates, rejection and pin', async () => {
  const store = useSession.getState();

  // Episode A: build up a full visual state.
  store.select('shoulder.deltoid');
  store.reject('shoulder.acromion');
  store.setDepth('deep');
  store.pinAt({ x: 0.3, y: 0.7 });

  const during = anatomy.getState();
  assert.ok(during.selectedStructureIds.length > 0, 'setup: nothing was selected');
  assert.ok(during.rejectedStructureIds.length > 0, 'setup: nothing was rejected');
  assert.ok(during.activePin, 'setup: no pin was dropped');

  // Episode B begins.
  useSession.getState().reset();

  const after = anatomy.getState();
  assert.deepEqual(after.selectedStructureIds, [], 'reset kept the previous selection');
  assert.deepEqual(after.rejectedStructureIds, [], 'reset kept the previous rejection');
  assert.deepEqual(after.highlightedStructureIds, [], 'reset kept stale candidates');
  assert.equal(after.activePin, null, 'reset kept the previous pin');
  // An empty record reports depth 'unknown', which means no depth has been
  // established — so every layer is shown. Carrying over episode A's 'deep'
  // would be the stale case this covers.
  assert.deepEqual(
    after.visibleLayers,
    TISSUE_LAYER_ORDER,
    'reset kept the previous depth',
  );
  // And the record itself is a fresh one.
  assert.equal(useSession.getState().stage, 'describe');
});

test('reset restores the default region and sub-region', async () => {
  const store = useSession.getState();
  store.selectSubRegion('shoulder.acromion');
  assert.deepEqual(anatomy.getState().visibleSubRegionIds, ['shoulder.acromion']);

  useSession.getState().reset();
  // focusRegion clears the sub-region set, so a new episode shows the whole
  // default region rather than one sub-region the user picked last time.
  assert.deepEqual(anatomy.getState().visibleSubRegionIds, []);
});

test('a new description replaces the previous candidates instead of adding to them', async () => {
  const restore = stubLocalise(
    groundedResponse('shoulder', 'shoulder.deltoid', ['shoulder.deltoid', 'shoulder.acromion']),
  );
  try {
    const store = useSession.getState();
    store.setUtterance('my shoulder aches');
    await useSession.getState().describe();
    assert.deepEqual(anatomy.getState().highlightedStructureIds, [
      'shoulder.deltoid',
      'shoulder.acromion',
    ]);
  } finally {
    restore();
  }

  // Second description in the same session, with a different suggestion.
  const restore2 = stubLocalise(groundedResponse('knee', 'knee.patella', ['knee.patella']));
  try {
    useSession.getState().setUtterance('now my knee');
    await useSession.getState().describe();
  } finally {
    restore2();
  }

  const after = anatomy.getState();
  assert.deepEqual(
    after.highlightedStructureIds,
    ['knee.patella'],
    'the previous description\'s candidates survived',
  );
  assert.equal(after.region, 'knee');
  assert.deepEqual(after.visibleSubRegionIds, ['knee.patella']);
});

test('a new description does not carry over a selection, rejection or pin', async () => {
  const restore = stubLocalise(groundedResponse('shoulder', 'shoulder.deltoid', ['shoulder.deltoid']));
  try {
    const store = useSession.getState();
    store.setUtterance('my shoulder aches');
    await useSession.getState().describe();
    // The user points at something and dismisses a suggestion.
    useSession.getState().select('shoulder.deltoid');
    useSession.getState().reject('shoulder.acromion');
    useSession.getState().pinAt({ x: 0.4, y: 0.6 });
    assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.deltoid']);
  } finally {
    restore();
  }

  // A different complaint entirely. The record it produces carries no selection,
  // so the viewer must not still be showing the first complaint's pointing.
  const restore2 = stubLocalise(groundedResponse('lower_back', 'lower_back.central', []));
  try {
    useSession.getState().setUtterance('actually my lower back');
    await useSession.getState().describe();
  } finally {
    restore2();
  }

  const after = anatomy.getState();
  assert.deepEqual(after.selectedStructureIds, [], 'a stale selection survived re-localisation');
  assert.deepEqual(after.rejectedStructureIds, [], 'a stale rejection survived re-localisation');
  assert.deepEqual(after.highlightedStructureIds, [], 'a stale candidate survived re-localisation');
  assert.equal(after.region, 'lower_back');
});

test('the canonical selection survives a rejection, as the record requires', () => {
  const store = useSession.getState();
  store.select('shoulder.deltoid');
  assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.deltoid']);

  store.reject('shoulder.deltoid');
  // The record is the authority on what the user pointed at. A visual
  // "not that one" must not silently unselect it.
  assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.deltoid']);
  assert.deepEqual(anatomy.getState().rejectedStructureIds, ['shoulder.deltoid']);
  // And the record still lists it.
  assert.deepEqual(useSession.getState().record.location.userSelectedStructureIds, [
    'shoulder.deltoid',
  ]);

  // Only an explicit deselect changes the canonical set.
  store.deselect('shoulder.deltoid');
  assert.deepEqual(anatomy.getState().selectedStructureIds, []);
  assert.deepEqual(useSession.getState().record.location.userSelectedStructureIds, []);
});

test('a candidate highlight never reaches into the canonical selection', async () => {
  const store = useSession.getState();
  store.select('shoulder.deltoid');
  assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.deltoid']);

  // Re-running localisation replaces the candidate list. Note this also clears
  // the selection, because `applyLocalisation` builds a fresh record whose
  // userSelectedStructureIds is empty — so the viewer is being told to clear it,
  // not clearing it on its own. That distinction is the whole invariant: the
  // viewer's selection may only change because the RECORD's selection changed.
  const restore = stubLocalise(
    groundedResponse('shoulder', 'shoulder.deltoid', ['shoulder.acromion']),
  );
  try {
    useSession.getState().setUtterance('my shoulder aches');
    await useSession.getState().describe();
  } finally {
    restore();
  }

  // The record says nothing is selected any more, and the viewer agrees.
  assert.deepEqual(useSession.getState().record.location.userSelectedStructureIds, []);
  assert.deepEqual(anatomy.getState().selectedStructureIds, []);
  // The candidate list is the new one, and it did not accumulate the old one.
  assert.deepEqual(anatomy.getState().highlightedStructureIds, ['shoulder.acromion']);
});

test('the viewer selection always equals the record selection', async () => {
  const store = useSession.getState();
  store.select('shoulder.deltoid');
  store.select('shoulder.acromion');
  assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.deltoid', 'shoulder.acromion']);
  // Rejections and highlights are presentation; the record is untouched by them.
  store.reject('shoulder.acromion');
  assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.deltoid', 'shoulder.acromion']);
  store.unreject('shoulder.acromion');
  assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.deltoid', 'shoulder.acromion']);
  store.deselect('shoulder.deltoid');
  assert.deepEqual(anatomy.getState().selectedStructureIds, ['shoulder.acromion']);
  // Every step, the two agree.
  assert.deepEqual(
    anatomy.getState().selectedStructureIds,
    useSession.getState().record.location.userSelectedStructureIds,
  );
  void store;
});