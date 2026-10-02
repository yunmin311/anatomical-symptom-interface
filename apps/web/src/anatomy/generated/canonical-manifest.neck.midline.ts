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
 * Archive:    unknown
 * Dataset:    unknown
 * Side:       midline -- every entry in this file carries laterality: 'midline'
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
      "asiId": "asi:neck.cervical-spine",
      "meshName": null,
      "region": "neck",
      "subRegionIds": [
        "neck.anterior",
        "neck.lateral",
        "neck.posterior"
      ],
      "layer": "bone",
      "anatomicalLabel": "Cervical spine",
      "layTerm": "the neck bones",
      "laterality": "midline",
      "fma": null,
      "source": null,
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 2232,
        "sourceTriangles": 15212,
        "reduction": 0.8533,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -39.40745,
          -91.10480000000001,
          1366.468695652174
        ],
        "max": [
          40.2307,
          -21.2664,
          1480.995
        ]
      },
      "file": null,
      "composite": {
        "selectable": false,
        "reason": "the source models each cervical vertebra separately (atlas, axis, C3-C7); one canonical selection covers all seven",
        "components": [
          {
            "meshName": "FJ3176",
            "fma": {
              "conceptId": "12519",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:12519",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": "2026-10-02"
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 200,
              "sourceTriangles": 2094,
              "reduction": 0.9045,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -39.40745,
                -83.51466111111112,
                1464.5002564102567
              ],
              "max": [
                40.2307,
                -42.04531481481482,
                1480.995
              ]
            },
            "file": "neck/asi-neck-cervical-spine-FJ3176.glb",
            "sourceLabel": "atlas"
          },
          {
            "meshName": "FJ3177",
            "fma": {
              "conceptId": "12520",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:12520",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": "2026-10-02"
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 470,
              "sourceTriangles": 2288,
              "reduction": 0.7946,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -24.962933333333325,
                -86.17096666666667,
                1434.7185185185183
              ],
              "max": [
                24.5742,
                -38.2568,
                1477.1881818181819
              ]
            },
            "file": "neck/asi-neck-cervical-spine-FJ3177.glb",
            "sourceLabel": "axis"
          },
          {
            "meshName": "FJ3161",
            "fma": {
              "conceptId": "12521",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:12521",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": "2026-10-02"
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 286,
              "sourceTriangles": 2030,
              "reduction": 0.8591,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -28.48646875,
                -87.306,
                1418.6606451612902
              ],
              "max": [
                28.5393,
                -39.3444725,
                1444.9
              ]
            },
            "file": "neck/asi-neck-cervical-spine-FJ3161.glb",
            "sourceLabel": "third cervical vertebra"
          },
          {
            "meshName": "FJ3164",
            "fma": {
              "conceptId": "12522",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:12522",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": "2026-10-02"
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 326,
              "sourceTriangles": 2410,
              "reduction": 0.8647,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -25.88891111111111,
                -88.80769999999998,
                1406.0572727272727
              ],
              "max": [
                26.3775,
                -41.751000000000005,
                1432.045
              ]
            },
            "file": "neck/asi-neck-cervical-spine-FJ3164.glb",
            "sourceLabel": "fourth cervical vertebra"
          },
          {
            "meshName": "FJ3167",
            "fma": {
              "conceptId": "12523",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:12523",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": "2026-10-02"
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 352,
              "sourceTriangles": 2196,
              "reduction": 0.8397,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -28.4733,
                -89.9258,
                1395.4231578947367
              ],
              "max": [
                28.3332,
                -37.288061290322574,
                1417.6844444444444
              ]
            },
            "file": "neck/asi-neck-cervical-spine-FJ3167.glb",
            "sourceLabel": "fifth cervical vertebra"
          },
          {
            "meshName": "FJ3170",
            "fma": {
              "conceptId": "12524",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:12524",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": "2026-10-02"
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 318,
              "sourceTriangles": 2374,
              "reduction": 0.866,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -29.499972727272723,
                -91.10480000000001,
                1383.8380000000002
              ],
              "max": [
                28.689241025641024,
                -29.1794,
                1403.8462499999998
              ]
            },
            "file": "neck/asi-neck-cervical-spine-FJ3170.glb",
            "sourceLabel": "sixth cervical vertebra"
          },
          {
            "meshName": "FJ3172",
            "fma": {
              "conceptId": "12525",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:12525",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": "2026-10-02"
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 280,
              "sourceTriangles": 1820,
              "reduction": 0.8462,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -31.829473684210527,
                -89.3702625,
                1366.468695652174
              ],
              "max": [
                31.1332,
                -21.2664,
                1390.6026666666667
              ]
            },
            "file": "neck/asi-neck-cervical-spine-FJ3172.glb",
            "sourceLabel": "seventh cervical vertebra"
          }
        ]
      }
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
export const CANONICAL_ASSET_ROOT = '/anatomy/neck/midline/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = 'midline' as const;

/** The region this build represents, so a caller cannot mix scenes. */
export const CANONICAL_REGION = 'neck' as const;
