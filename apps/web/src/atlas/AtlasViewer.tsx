/**
 * RIGHT SHOULDER anatomy atlas viewer.
 *
 * ## Layout intent
 *
 * The canvas is the primary workspace. The control rail is a fixed fraction of
 * the viewport beside it on wide screens and moves below it on narrow ones, with
 * the canvas keeping the majority of the height either way. Losing the model on a
 * small screen is the failure that matters; a cramped control list is not.
 *
 * ## Control grouping
 *
 * Four groups, in the order a person actually works: NAVIGATION (where am I),
 * ANATOMY SYSTEMS (what is switched on), STRUCTURE (what am I looking at), VIEW
 * (how is it drawn). They are visually distinct headings rather than one flat run
 * of same-level radio controls.
 *
 * ## What this component must never do
 *
 * It never writes anatomy data. Selection and layer state are local to the
 * viewer here. The record's own user-selection semantics live in
 * packages/shared/src/symptom.ts and are not touched by this spike; wiring a
 * chosen structure to the record is a separate, explicit step.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AtlasScene, type AtlasManifest, type SectionOptions } from './atlas-scene.ts';
import {
  INITIAL_ATLAS_STATE,
  searchStructures,
  select as selectAction,
  setBodyVisible,
  setMode,
  setOpacity,
  setSystem,
  toggleHidden,
  type AtlasMode,
  type AtlasState,
} from './atlas-state.ts';
import { SYSTEM_LABEL, type System } from './material-system.ts';
import { PRIMARY_PRESETS, CAMERA_PRESETS, cueText, orientationCue, type PresetName } from './camera-presets.ts';
import { coverageForRegion, coverageSentence, type SystemCoverage } from './coverage.ts';
import type { FidelityPolicy } from './fidelity.ts';

/**
 * The atlas asset root.
 *
 * Deliberately `anatomy/atlas/...`, not `anatomy/shoulder/right/`. The second path
 * holds the canonical per-mesh GLBs and the canonical manifest, which the product
 * embeds at build time; the viewer has no business reading either. Keeping the two
 * in different directories is what stops "just point the viewer at the other
 * manifest" from being a one-line change that destroys a shared contract.
 */
const ASSET_ROOT = '/anatomy/atlas/shoulder/right/';

const MODES: ReadonlyArray<{ id: AtlasMode; label: string; hint: string }> = [
  {
    id: 'explore',
    label: 'Explore',
    hint: 'Everything you have switched on is drawn normally.',
  },
  {
    id: 'isolate',
    label: 'Isolate',
    hint: 'The selected structure stays solid. Everything around it fades back so you keep your bearings.',
  },
  {
    id: 'solo',
    label: 'Solo',
    hint: 'Only the selected structure is drawn. You lose the surrounding anatomy.',
  },
];

export function AtlasViewer() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<AtlasScene | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [manifest, setManifest] = useState<AtlasManifest | null>(null);
  const [state, setState] = useState<AtlasState>(INITIAL_ATLAS_STATE);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [cue, setCue] = useState('A / level / level');
  const [fidelity, setFidelity] = useState<{ inBand: boolean; policy: FidelityPolicy } | null>(null);
  const [section, setSection] = useState<SectionOptions>({
    enabled: false,
    axis: 'x',
    position: 0.5,
    flip: false,
  });
  const [framing, setFraming] = useState<'body' | 'region'>('region');

  /* ------------------------------------------------------------- lifecycle */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new AtlasScene(host, {
      assetRoot: ASSET_ROOT,
      onHover: (id) => setState((s) => ({ ...s, hoveredId: id })),
      onSelect: (id) => handlePick(id),
      onCamera: (eye, target) => setCue(cueText(orientationCue({ eye, target }))),
      onFidelityBand: (inBand, policy) => setFidelity((f) => (f?.inBand === inBand ? f : { inBand, policy })),
    });
    sceneRef.current = scene;

    const onResize = () => scene.resize();
    globalThis.addEventListener('resize', onResize);

    scene
      .load()
      .then(() => {
        setManifest(scene.manifest);
        scene.frameRegion('front');
        setReady(true);
      })
      .catch((err: unknown) => {
        setFailed(err instanceof Error ? err.message : String(err));
      });

    return () => {
      globalThis.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push state into the scene whenever it changes -- and once more when the model
  // finishes loading.
  //
  // The `ready` dependency is load-bearing, not decorative. On first mount
  // applyState runs against an EMPTY node map, because the GLB has not parsed
  // yet, so no materials are assigned. Without re-running on ready, the viewer sat
  // there in the glTF default white until the user touched any control, which
  // changed state and forced the effect. That is the original grey-blob failure
  // reappearing intermittently: a passing gate that exercised controls first never
  // saw it, and a plain page load on a phone did.
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.applyState(state);
  }, [state, ready]);

  useEffect(() => {
    sceneRef.current?.setSection(section);
  }, [section]);

  useEffect(() => {
    if (!ready) return;
    if (framing === 'body') sceneRef.current?.frameBody();
    else sceneRef.current?.frameRegion('front');
  }, [framing, ready]);

  /* ---------------------------------------------------------------- actions */

  const handlePick = useCallback((id: string | null) => {
    setState((s) => {
      const next = selectAction(s, id);
      // Selecting a structure adopts isolate, because that is the primary action
      // and it keeps the user oriented. Solo is never automatic.
      return id && next.mode === 'explore' ? { ...next, mode: 'isolate' } : next;
    });
    if (id) {
      sceneRef.current?.frameStructure(id);
      setFraming('region');
    }
  }, []);

  const structures = useMemo(
    () =>
      (manifest?.structures ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        system: s.presentationSystem as System,
      })),
    [manifest],
  );

  const hits = useMemo(() => searchStructures(structures, query), [structures, query]);

  const coverage = useMemo(() => {
    const present = [...new Set((manifest?.structures ?? []).map((s) => s.presentationSystem))];
    return coverageForRegion('Shoulder', present);
  }, [manifest]);

  const selected = state.selectedId
    ? (manifest?.structures ?? []).find((s) => s.id === state.selectedId) ?? null
    : null;

  const availableBySystem = useMemo(() => {
    const map = new Map<string, SystemCoverage>();
    for (const c of coverage.available) map.set(c.system, c);
    return map;
  }, [coverage]);

  const orderedAvailable = useMemo(
    () => ['bone', 'muscle', 'artery', 'vein', 'skin'].filter((s) => availableBySystem.has(s)),
    [availableBySystem],
  );

  /* ------------------------------------------------------------------ render */

  if (failed) {
    return (
      <div className="atlas-fail" role="alert">
        <p className="t-section">The anatomy model could not be loaded</p>
        <p className="t-annotation">{failed}</p>
      </div>
    );
  }

  return (
    <div className="atlas">
      <header className="atlas__head">
        <div>
          <p className="t-eyebrow">Anatomy</p>
          <h1 className="t-display">Right shoulder</h1>
        </div>
        <p className="t-annotation atlas__attribution">
          {manifest?.provenance.attribution ?? 'BodyParts3D'}
          {' · '}
          {manifest?.provenance.licence ?? 'CC BY 4.0'}
        </p>
      </header>

      <div className="atlas__body">
        <div className="atlas__stage on-canvas">
          <div className="atlas__canvas" ref={hostRef} />

          <div className="atlas__overlay atlas__overlay--tl">
            <span className="atlas__cue" title="Anatomical direction you are looking from">
              {cue}
            </span>
            <span className="atlas__cue-label">anterior/posterior · left/right · superior/inferior</span>
          </div>

          {fidelity?.inBand && (
            <p className="atlas__fidelity" role="status">
              {fidelity.policy.notice}
            </p>
          )}

          {!ready && <p className="atlas__loading">Loading anatomy…</p>}
        </div>

        <aside className="atlas__rail" aria-label="Anatomy controls">
          {/* ---------------------------------------------------- NAVIGATION */}
          <section className="atlas__group">
            <h2 className="t-eyebrow">Navigation</h2>
            <div className="atlas__row">
              <button
                type="button"
                className={`atlas__btn${framing === 'body' ? ' is-on' : ''}`}
                aria-pressed={framing === 'body'}
                onClick={() => setFraming('body')}
              >
                Whole body
              </button>
              <button
                type="button"
                className={`atlas__btn${framing === 'region' ? ' is-on' : ''}`}
                aria-pressed={framing === 'region'}
                onClick={() => setFraming('region')}
              >
                Shoulder
              </button>
            </div>
            <p className="t-meta">Whole body gives you context. Shoulder frames the region.</p>
          </section>

          {/* ---------------------------------------------- ANATOMY SYSTEMS */}
          <section className="atlas__group">
            <h2 className="t-eyebrow">Anatomy systems</h2>
            <p className="t-meta atlas__groupnote">In this model for the shoulder</p>
            <ul className="atlas__layers">
              {orderedAvailable.map((system) => {
                const c = availableBySystem.get(system)!;
                const on = state.systemVisibility[system] !== false;
                return (
                  <li key={system}>
                    <label className="atlas__layer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setState((s) => setSystem(s, system, !on))}
                      />
                      <span
                        className="atlas__swatch"
                        style={{ background: swatchFor(system) }}
                        aria-hidden="true"
                      />
                      <span className="atlas__layername">{SYSTEM_LABEL[system as System] ?? c.label}</span>
                      <span className="atlas__count">{c.structuresInRegion}</span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <p className="t-meta atlas__groupnote atlas__groupnote--gap">Not in this model for the shoulder</p>
            <ul className="atlas__layers atlas__layers--absent">
              {coverage.notInSource.map((c) => (
                <li key={c.system} className="atlas__absent">
                  <span className="atlas__layername">{SYSTEM_LABEL[c.system as System] ?? c.system}</span>
                  <span className="t-meta">{coverageSentence(c)}</span>
                </li>
              ))}
            </ul>
            <p className="t-meta atlas__absentnote">
              These tissues exist in the shoulder. This particular model does not include them, so there
              is nothing to show. That is a gap in the source data, not in the anatomy.
            </p>
          </section>

          {/* ----------------------------------------------------- STRUCTURE */}
          <section className="atlas__group">
            <h2 className="t-eyebrow">Structure</h2>
            <div className="atlas__search">
              <input
                type="search"
                className="atlas__input"
                placeholder="Search structures"
                value={query}
                aria-label="Search anatomical structures"
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
              />
              {searchOpen && query && (
                <ul className="atlas__results" role="listbox" aria-label="Search results">
                  {hits.length === 0 && <li className="t-meta atlas__results-empty">No match in this model</li>}
                  {hits.map((h) => (
                    <li key={h.item.id}>
                      <button
                        type="button"
                        className="atlas__result"
                        onClick={() => {
                          handlePick(h.item.id);
                          setSearchOpen(false);
                          setQuery('');
                        }}
                      >
                        <span>{h.item.label}</span>
                        <span className="t-meta">{SYSTEM_LABEL[h.item.system] ?? h.item.system}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selected ? (
              <div className="atlas__selected">
                <p className="t-group">{selected.label}</p>
                <p className="t-meta">
                  {SYSTEM_LABEL[selected.presentationSystem as System] ?? selected.presentationSystem}
                  {selected.fma?.conceptId ? ` · ${selected.fma.conceptId}` : ''}
                  {/*
                    Whether this selection may become a SymptomRecord entry, stated
                    plainly. A structure with no canonical asi id can still be
                    looked at, searched, isolated and hidden -- it simply has no
                    legal value to write. Silently treating the two the same is how
                    a bp3d:FJ#### id would reach the record.
                  */}
                  {selected.symptomRecordSelectable === false && (
                    <span className="atlas__flag">
                      {' '}View only · no {selected.canonicalAsiId ? '' : 'canonical structure'} to
                      record
                    </span>
                  )}
                </p>
                <div className="atlas__row">
                  <button
                    type="button"
                    className={`atlas__btn${state.hiddenIds.includes(selected.id) ? ' is-off' : ''}`}
                    aria-pressed={state.hiddenIds.includes(selected.id)}
                    onClick={() => setState((s) => toggleHidden(s, selected.id))}
                  >
                    {state.hiddenIds.includes(selected.id) ? 'Unhide' : 'Hide'}
                  </button>
                  <button type="button" className="atlas__btn" onClick={() => setState((s) => ({ ...s, selectedId: null }))}>
                    Clear
                  </button>
                </div>
                {selected.presentationSystemClassification === 'evidence_supported' && (
                  <p className="t-meta atlas__flag">
                    Presented as{' '}
                    {SYSTEM_LABEL[selected.presentationSystem as System]?.toLowerCase()} on published
                    anatomical evidence. Its underlying ontology links have not been checked by a person.
                  </p>
                )}
              </div>
            ) : (
              <p className="t-annotation">Click a structure in the model, or search for one.</p>
            )}

            <div className="atlas__row atlas__row--modes" role="group" aria-label="How much to show">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`atlas__btn${state.mode === m.id ? ' is-on' : ''}`}
                  aria-pressed={state.mode === m.id}
                  onClick={() => setState((s) => setMode(s, m.id))}
                  title={m.hint}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="t-meta">{MODES.find((m) => m.id === state.mode)?.hint}</p>

            <label className="atlas__slider">
              <span className="t-label">Opacity</span>
              <input
                type="range"
                min={5}
                max={100}
                value={Math.round(state.opacity * 100)}
                onChange={(e) => setState((s) => setOpacity(s, Number(e.target.value) / 100))}
              />
            </label>
          </section>

          {/* ----------------------------------------------------------- VIEW */}
          <section className="atlas__group">
            <h2 className="t-eyebrow">View</h2>
            <div className="atlas__row" role="group" aria-label="Anatomical camera">
              {PRIMARY_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="atlas__btn"
                  title={CAMERA_PRESETS[p].looksAt}
                  onClick={() => sceneRef.current?.setPresetImmediate(p)}
                >
                  {CAMERA_PRESETS[p].label}
                </button>
              ))}
            </div>
            <div className="atlas__row">
              <button type="button" className="atlas__btn" onClick={() => sceneRef.current?.frameBody()}>
                Reset view
              </button>
              <label className="atlas__check">
                <input
                  type="checkbox"
                  checked={state.bodyVisible}
                  onChange={(e) => setState((s) => setBodyVisible(s, e.target.checked))}
                />
                <span>Whole body shell</span>
              </label>
            </div>

            <label className="atlas__check atlas__check--gap">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(e) => setSection((s) => ({ ...s, enabled: e.target.checked }))}
              />
              <span>Section view</span>
            </label>
            {section.enabled && (
              <div className="atlas__section">
                <p className="t-meta">
                  A cut through the surface model. This is not a CT or MRI slice — there is no internal
                  data to show.
                </p>
                <div className="atlas__row">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <button
                      key={axis}
                      type="button"
                      className={`atlas__btn atlas__btn--tiny${section.axis === axis ? ' is-on' : ''}`}
                      aria-pressed={section.axis === axis}
                      onClick={() => setSection((s) => ({ ...s, axis }))}
                    >
                      {axis === 'x' ? 'Left/Right' : axis === 'y' ? 'Up/Down' : 'Front/Back'}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(section.position * 100)}
                  aria-label="Section position"
                  onChange={(e) => setSection((s) => ({ ...s, position: Number(e.target.value) / 100 }))}
                />
                <label className="atlas__check">
                  <input
                    type="checkbox"
                    checked={section.flip}
                    onChange={(e) => setSection((s) => ({ ...s, flip: e.target.checked }))}
                  />
                  <span>Keep the other side</span>
                </label>
              </div>
            )}
          </section>

          {manifest?.provenance.fidelity && (
            <section className="atlas__group atlas__group--foot">
              <h2 className="t-eyebrow">About this model</h2>
              <p className="t-meta">{manifest.provenance.fidelity}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** The system base colour, for the layer swatches. */
function swatchFor(system: string): string {
  const map: Record<string, string> = {
    bone: '#f4efe0',
    muscle: '#b0705f',
    artery: '#cf4a45',
    vein: '#3f5f9e',
    skin: '#e0b39a',
  };
  return map[system] ?? '#6d7176';
}
