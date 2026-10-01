import { useMemo } from "react";
import type { RendererSceneManifest } from "../anatomy/scene-manifest.ts";
import { sceneLicenceEvidence } from "../anatomy/asset-scene-adapter.ts";

/**
 * Where the anatomy geometry came from, and what it is not.
 *
 * A redistributed mesh with no attribution line is a licence violation, and the
 * cheapest moment to prevent one is before it ships. So this is not a footer
 * nicety: when a real third-party asset is in use, its licence, attribution
 * string and source release are reachable from here, with a working link.
 *
 * It is a `<details>` disclosure rather than a banner because attribution is
 * reference material, not an instruction: it must be genuinely reachable without
 * competing with the thing the user came to do. `<details>` is chosen over a
 * hand-rolled toggle because it is keyboard-operable and announced as a
 * disclosure by the platform already, and an accessibility gate should not have
 * to be told that.
 *
 * NOTHING HERE IS AUTHORED. Every value comes from the canonical manifest through
 * the adapter, and `sceneLicenceEvidence` returns null for synthetic geometry, so
 * there is no code path that can print a licence for an asset that has none.
 */
export function AnatomyAttribution({ scene }: { scene: RendererSceneManifest }) {
  const evidence = useMemo(() => sceneLicenceEvidence(scene), [scene]);
  const synthetic = scene.source === "fixture";

  return (
    <details className="anatomy-attribution" data-testid="anatomy-attribution">
      <summary data-testid="anatomy-attribution-summary">
        About anatomy data
      </summary>

      <div className="anatomy-attribution__body">
        {/*
          The fixture case comes FIRST and says what the geometry is not, because
          that is the fact a reader needs and it is the one a licence line would
          obscure. A synthetic asset shown beside a licence reads as a source
          dataset, which is precisely the wrong impression.
        */}
        {synthetic ? (
          <>
            <p
              className="anatomy-attribution__warning"
              data-testid="anatomy-attribution-synthetic"
            >
              This build is showing placeholder geometry. It is generated test
              data: it is not anatomy, it is not derived from any body dataset, and
              it carries no anatomical meaning. Do not use it to work out what is
              wrong with you.
            </p>
            {scene.disclaimer ? (
              <p className="muted small">{scene.disclaimer}</p>
            ) : null}
          </>
        ) : evidence ? (
          <>
            <h3>Anatomy data</h3>
            <dl data-testid="anatomy-attribution-evidence">
              <dt>Licence</dt>
              <dd>
                <a href={evidence.licenceUrl} rel="license noopener noreferrer">
                  {evidence.licenceName} ({evidence.licenceId})
                </a>
              </dd>
              <dt>Attribution</dt>
              <dd data-testid="anatomy-attribution-string">
                {evidence.attribution}
              </dd>
              <dt>Source</dt>
              <dd data-testid="anatomy-attribution-source">
                {evidence.dataset}, release {evidence.release}
              </dd>
            </dl>
            <p className="muted small">
              Geometry is shown for orientation only. A visual selection is
              something you pointed at, not a finding.
            </p>
          </>
        ) : (
          /*
            A production scene with no attribution is a build fault, not a state to
            word around. Saying so plainly beats printing an empty licence block,
            and it is the one case here that must never be quiet.
          */
          <p
            className="anatomy-attribution__warning"
            data-testid="anatomy-attribution-missing"
          >
            This build is loading anatomy geometry but does not record where it
            came from. That is a packaging error, and the geometry should not be
            relied on until it is fixed.
          </p>
        )}

        {/*
          The external-asset notice is DERIVED from the canonical manifest, so it
          is shown for a production scene and withheld for a fixture — where it
          would read as provenance for a test asset.
        */}
        {!synthetic && scene.externalAssetNotice ? (
          <p className="muted small" data-testid="anatomy-attribution-notice">
            {scene.externalAssetNotice}
          </p>
        ) : null}
      </div>
    </details>
  );
}