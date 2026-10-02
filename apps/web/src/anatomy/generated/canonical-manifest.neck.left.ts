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
 * Side:       left -- every entry in this file carries `laterality: 'left'`.
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
      "meshName": "FJ1573",
      "region": "neck",
      "subRegionIds": [
        "neck.anterior",
        "neck.lateral"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Sternocleidomastoid",
      "layTerm": "the band running from behind the ear to the collarbone",
      "laterality": "left",
      "fma": {
        "conceptId": "13409",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:13409",
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
        "triangles": 166,
        "sourceTriangles": 10224,
        "reduction": 0.9838,
        "units": "mm"
      },
      "bounds": {
        "min": [
          8.44346568335036,
          -150.40702553626156,
          1309.339060265576
        ],
        "max": [
          61.20592528089881,
          -41.3888,
          1503.0199999999998
        ]
      },
      "file": "neck/asi-neck-sternocleidomastoid.glb"
    },
    {
      "asiId": "asi:neck.levator-scapulae",
      "meshName": "FJ1532M",
      "region": "neck",
      "subRegionIds": [
        "neck.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Levator scapulae",
      "layTerm": "the muscle from the neck to the shoulder blade",
      "laterality": "left",
      "fma": {
        "conceptId": "32541",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32541",
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
        "triangles": 146,
        "sourceTriangles": 4718,
        "reduction": 0.9691,
        "units": "mm"
      },
      "bounds": {
        "min": [
          27.47873376288657,
          -77.78168840970356,
          1315.3812857142868
        ],
        "max": [
          74.7183015594542,
          -15.772218095238092,
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
export const CANONICAL_ASSET_ROOT = '/anatomy/neck/left/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = 'left' as const;

/** The region this build represents, so a caller cannot mix scenes. */
export const CANONICAL_REGION = 'neck' as const;
