import { useEffect, useRef, useState } from 'react';
import { AnatomyWorkspace } from './workspace.ts';
import type { WorkspaceStatus } from './workspace.ts';
import type { Side } from '@asi/shared';
import { sceneFor } from './active-scene.ts';
import { AnatomyAttribution } from '../ui/AnatomyAttribution.tsx';
import type { PickResult } from './types.ts';
import { anatomy } from '../state/session.ts';

/**
 * Host for the 3D viewer, with the 2D map as the floor.
 *
 * The canvas is progressive enhancement. It is mounted into a measured host,
 * every failure path lands on the 2D map, and the user is told in words which
 * one they are looking at. The fixture disclaimer is surfaced here too, because
 * a development placeholder that reads like a finished anatomy product is the
 * single most misleading thing this screen could do.
 *
 * There is no drag-to-rotate requirement: the camera moves by preset, and every
 * sub-region is also reachable from the inspector's keyboard-reachable buttons.
 */
export function Body3d({
  onPick,
  onStatus,
  active,
  side,
  region,
}: {
  /**
   * A raycast result, reported whole. Deliberately not narrowed to a sub-region:
   * what a click means depends on whether the user hit an area or a structure, and
   * that decision belongs to the session's caller, not to the renderer host.
   */
  onPick: (hit: PickResult) => void;
  /**
   * The record's side, and it decides WHICH real scene is mounted.
   *
   * The viewer shows one shoulder at a time, so rendering "the" scene without asking
   * this question means guessing -- and the guess is invisible: left anatomy looks
   * exactly like right anatomy until you know which one you are looking at.
   */
  side: Side;
  /**
   * The record's region, which with `side` selects WHICH real scene is mounted.
   *
   * Both are needed. A scene is identified by region AND side, so a viewer given only
   * a side could render a neck for a shoulder complaint, and nothing about that would
   * look wrong until someone read the attribution.
   */
  region: string;
  /**
   * Full workspace status. The caller needs the fallback REASON, not just a
   * boolean, to tell "still starting" apart from "gave up": switching surfaces
   * on the initial not-ready status would cancel the mount that was in flight.
   */
  onStatus?: (status: WorkspaceStatus) => void;
  /** Ask for the 3D surface at all. */
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<AnatomyWorkspace | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  // Which scene the record's side calls for, decided once per side so the effect below
  // remounts when the side changes rather than on every render.
  const selection = sceneFor(region, side);
  const mountable = selection.kind === 'scene' ? selection.scene : null;
  // `both` mounts one scene at a time too; the viewer shows a side, and the toolbar says
  // which. So it is mountable, and it is the only case with no `reason`.
  const bilateral = selection.kind === 'both' ? selection.scenes[0] : null;
  const scene = mountable ?? bilateral;
  const reason =
    selection.kind === 'needs-side' || selection.kind === 'needs-region' || selection.kind === 'none'
      ? selection.reason
      : null;
  const notMountable = reason !== null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    if (!scene) return;
    let cancelled = false;
    const workspace = new AnatomyWorkspace(anatomy, { manifest: scene });
    workspaceRef.current = workspace;
    const unsubscribe = workspace.subscribe((next) => {
      if (cancelled) return;
      setStatus(next);
      onStatusRef.current?.(next);
    });

    workspace.start(host).catch(() => {
      // start() is documented not to throw, but a blank canvas would be the one
      // unacceptable outcome, so belt-and-braces back to 2D.
      if (!cancelled) setFailed(true);
    });

    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box) workspace.resize(box.width, box.height);
      }) : null;
    observer?.observe(host);

    return () => {
      cancelled = true;
      observer?.disconnect();
      unsubscribe();
      workspace.dispose();
      workspaceRef.current = null;
    };
    // `mountable` rather than `side`: it is the scene identity, so a rebuild that
    // produces an equal-but-new object remounts and an unchanged side does not.
  }, [active, scene]);

  const workspace = workspaceRef.current;
  const live3d = status?.mode === '3d' && !failed;

  return (
    <div
      className={`viewer3d${active ? '' : ' viewer3d--idle'}`}
      data-testid="viewer-3d"
      hidden={!active}
    >
      {/*
        Stated where the canvas is, because a 3D viewer with no side named is the one
        place a user could look at left anatomy and believe it was right. This is the
        record's side, the same one that chose the scene.
      */}
      {notMountable && (
        <p className="viewer3d__disclaimer" data-testid="side-required">
          {reason}
        </p>
      )}
      {/*
        The mode indicator lives in the panel toolbar, so this bar carries only
        what the canvas cannot say for itself: that these are placeholder
        volumes, and why there is no image.
      */}
      <div className="viewer3d__toolbar">
        {side !== 'unknown' && side !== 'bilateral' && scene && (
          <p className="viewer3d__side" data-testid="viewer-side">
            Showing your {side} side.
          </p>
        )}
        {status?.disclaimer && (
          <p className="viewer3d__disclaimer" data-testid="fixture-disclaimer">
            {status.disclaimer}
          </p>
        )}
        {/*
          Attribution lives here, next to the geometry it describes. It is a
          disclosure rather than a banner so it is reachable without competing with
          the map, and it reads the canonical provenance through the adapter, so
          there is no path by which a licence gets typed in by hand.
        */}
        {scene && <AnatomyAttribution scene={scene} />}
      </div>

      {/* The host is always mounted so a fallback has somewhere to go. */}
      <div
        ref={hostRef}
        className={`viewer3d__canvas${live3d ? '' : ' is-hidden'}`}
        data-testid="viewer-3d-canvas"
        onClick={(event) => {
          if (!live3d || !workspaceRef.current) return;
          /*
            The WHOLE pick, not a sub-region id.
            
            The previous handler destructured `hit.subRegionId`, which is present only
            when a pick has exactly one sub-region — so a click on a structure
            reachable from several places did nothing at all, and a click on one with
            a single sub-region recorded an AREA and lost the structure the user had
            actually pointed at. It also dropped `hit.point`, so a click on real mesh
            never became a location indication.
            
            Deciding what a pick MEANS is `intentFromPick`'s job, and it is pure. This
            component stays a renderer host: it reports a raycast result and does not
            decide anything about the record.
          */
          onPick(workspaceRef.current.pick(event.clientX, event.clientY));
        }}
      />

      {/*
        Announced rather than shown as an overlay: a failure must be legible
        without colour and without taking the map away.
      */}
      <p className="sr-only" role="status" data-testid="viewer-status">
        {status?.message ?? (live3d ? '3D viewer active.' : 'Body map active.')}
      </p>

      {status?.message && (
        <p className="viewer3d__fallback" data-testid="viewer-fallback">
          {status.message}
        </p>
      )}
    </div>
  );
}
