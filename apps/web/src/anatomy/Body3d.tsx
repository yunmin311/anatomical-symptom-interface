import { useEffect, useRef, useState } from 'react';
import { AnatomyWorkspace } from './workspace.ts';
import type { WorkspaceStatus } from './workspace.ts';
import { ACTIVE_SCENE } from './active-scene.ts';
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
}: {
  /**
   * A raycast result, reported whole. Deliberately not narrowed to a sub-region:
   * what a click means depends on whether the user hit an area or a structure, and
   * that decision belongs to the session's caller, not to the renderer host.
   */
  onPick: (hit: PickResult) => void;
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    let cancelled = false;
    const workspace = new AnatomyWorkspace(anatomy, { manifest: ACTIVE_SCENE });
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
  }, [active]);

  const workspace = workspaceRef.current;
  const live3d = status?.mode === '3d' && !failed;

  return (
    <div
      className={`viewer3d${active ? '' : ' viewer3d--idle'}`}
      data-testid="viewer-3d"
      hidden={!active}
    >
      {/*
        The mode indicator lives in the panel toolbar, so this bar carries only
        what the canvas cannot say for itself: that these are placeholder
        volumes, and why there is no image.
      */}
      <div className="viewer3d__toolbar">
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
        <AnatomyAttribution scene={ACTIVE_SCENE} />
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
