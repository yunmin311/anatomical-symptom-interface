/**
 * GENERATED FILE. DO NOT EDIT.
 *
 * Produced by scripts/embed-anatomy-manifest.mjs from
 * assets/anatomy/generated/<region>/<side>/manifest.json.
 *
 * The canonical anatomy manifest, as data. The app parses it through
 * `parseManifest` and converts it with `toRendererScene` at startup, so the
 * production scene is built by the same contract as everything else rather than by a
 * hand-written scene that could drift from the pipeline.
 *
 * Provenance: BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International
 * Licence:    Creative Commons Attribution 4.0 International (CC-BY-4.0) -- https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
 * Archive:    isa_BP3D_4.0_obj_99.zip
 * Dataset:    BodyParts3D 4.0
 * Side:       right -- every entry in this file carries `laterality: 'right'`.
 * Units:      mm, from the source model, not inferred here.
 */

import type { AssetManifest } from '@asi/shared';

/** The canonical manifest exactly as the pipeline wrote it. */
const CANONICAL_MANIFEST_JSON = {
  "schemaVersion": 1,
  "regions": [
    "neck"
  ],
  "licence": {
    "id": "CC-BY-4.0",
    "name": "Creative Commons Attribution 4.0 International",
    "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
    "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
    "verifiedOn": "2025-02-27"
  },
  "generator": {
    "name": "asi-anatomy-pipeline",
    "version": "1.0.0"
  },
  "entries": [
    {
      "asiId": "asi:neck.sternocleidomastoid",
      "meshName": "FJ1595",
      "region": "neck",
      "subRegionIds": [
        "neck.anterior",
        "neck.lateral"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Sternocleidomastoid",
      "layTerm": "the band running from behind the ear to the collarbone",
      "laterality": "right",
      "fma": {
        "conceptId": "13408",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:13408",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": null
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 198,
        "sourceTriangles": 10344,
        "reduction": 0.9809,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -59.59071620915026,
          -150.57871339563857,
          1309.4404049844245
        ],
        "max": [
          61.34296153846155,
          -37.65269333333335,
          1503.19
        ]
      },
      "file": "neck/asi-neck-sternocleidomastoid.glb"
    },
    {
      "asiId": "asi:neck.levator-scapulae",
      "meshName": "FJ1532",
      "region": "neck",
      "subRegionIds": [
        "neck.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Levator scapulae",
      "layTerm": "the muscle from the neck to the shoulder blade",
      "laterality": "right",
      "fma": {
        "conceptId": "32540",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32540",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": null
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 136,
        "sourceTriangles": 4718,
        "reduction": 0.9712,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -72.99564728096685,
          -78.91388194444451,
          1315.2367804878054
        ],
        "max": [
          -26.339029861111126,
          -15.703753170731709,
          1468.5600000000002
        ]
      },
      "file": "neck/asi-neck-levator-scapulae.glb"
    }
  ]
}
;

export const CANONICAL_ANATOMY_MANIFEST = CANONICAL_MANIFEST_JSON as unknown as AssetManifest;

/**
 * Where this side's generated geometry is served from.
 *
 * Per side, so the two builds cannot collide on a path. The renderer does not
 * hardcode this: it is read from the manifest and passed to the adapter.
 */
export const CANONICAL_ASSET_ROOT = '/anatomy/neck/right/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = 'right' as const;

/** The region this build represents, so a caller cannot mix scenes. */
export const CANONICAL_REGION = 'neck' as const;
