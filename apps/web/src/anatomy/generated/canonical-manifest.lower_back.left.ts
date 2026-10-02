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
    "lower_back"
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
      "asiId": "asi:lower-back.sacrum",
      "meshName": "FJ3393",
      "region": "lower_back",
      "subRegionIds": [
        "lower_back.sacrococcygeal"
      ],
      "layer": "bone",
      "anatomicalLabel": "Sacrum",
      "layTerm": "the triangular bone at the base of the spine",
      "laterality": "midline",
      "fma": {
        "conceptId": "16202",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:16202",
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
        "triangles": 458,
        "sourceTriangles": 9922,
        "reduction": 0.9538,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -56.446313636363634,
          -78.97049999999999,
          786.6946874999998
        ],
        "max": [
          57.38755555555555,
          6.707525,
          927.2
        ]
      },
      "file": "lower_back/asi-lower-back-sacrum.glb"
    },
    {
      "asiId": "asi:lower-back.gluteus-maximus",
      "meshName": "FJ1418M",
      "region": "lower_back",
      "subRegionIds": [
        "lower_back.sacrococcygeal"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Gluteus maximus",
      "layTerm": "the big buttock muscle",
      "laterality": "left",
      "fma": {
        "conceptId": "22329",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:22329",
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
        "triangles": 172,
        "sourceTriangles": 2376,
        "reduction": 0.9276,
        "units": "mm"
      },
      "bounds": {
        "min": [
          4.022911721428574,
          -73.15432000000001,
          677.9355333333336
        ],
        "max": [
          142.7268876404495,
          18.500633333333333,
          932.5570000000001
        ]
      },
      "file": "lower_back/asi-lower-back-gluteus-maximus.glb"
    },
    {
      "asiId": "asi:lower-back.lumbar-spine",
      "meshName": null,
      "region": "lower_back",
      "subRegionIds": [
        "lower_back.central",
        "lower_back.left_paravertebral",
        "lower_back.right_paravertebral"
      ],
      "layer": "bone",
      "anatomicalLabel": "Lumbar spine",
      "layTerm": "the lower back bones",
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
        "triangles": 1944,
        "sourceTriangles": 16862,
        "reduction": 0.8847,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -47.66909999999999,
          -114.87828571428572,
          905.3575454545455
        ],
        "max": [
          49.5736,
          -18.39635,
          1071.8083333333332
        ]
      },
      "file": null,
      "composite": {
        "selectable": false,
        "reason": "the source models each lumbar vertebra separately (L1-L5); one canonical selection covers all five",
        "components": [
          {
            "meshName": "FJ3157",
            "fma": {
              "conceptId": "13072",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:13072",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": null
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 396,
              "sourceTriangles": 2972,
              "reduction": 0.8668,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -33.313308695652175,
                -108.45933333333335,
                1016.8078571428571
              ],
              "max": [
                32.54189285714286,
                -29.2224,
                1071.8083333333332
              ]
            },
            "file": "lower_back/asi-lower-back-lumbar-spine-FJ3157.glb",
            "sourceLabel": "first lumbar vertebra"
          },
          {
            "meshName": "FJ3159",
            "fma": {
              "conceptId": "13073",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:13073",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": null
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 406,
              "sourceTriangles": 3214,
              "reduction": 0.8737,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -38.121766666666666,
                -113.8325,
                994.8302916666668
              ],
              "max": [
                37.351375,
                -34.3488,
                1038.3228571428572
              ]
            },
            "file": "lower_back/asi-lower-back-lumbar-spine-FJ3159.glb",
            "sourceLabel": "second lumbar vertebra"
          },
          {
            "meshName": "FJ3162",
            "fma": {
              "conceptId": "13074",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:13074",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": null
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 390,
              "sourceTriangles": 3272,
              "reduction": 0.8808,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -38.6967076923077,
                -114.87828571428572,
                970.1887083333335
              ],
              "max": [
                38.15447692307692,
                -29.514,
                1007.8167857142859
              ]
            },
            "file": "lower_back/asi-lower-back-lumbar-spine-FJ3162.glb",
            "sourceLabel": "third lumbar vertebra"
          },
          {
            "meshName": "FJ3165",
            "fma": {
              "conceptId": "13075",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:13075",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": null
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 396,
              "sourceTriangles": 3512,
              "reduction": 0.8872,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -41.116275,
                -109.372,
                939.5426249999999
              ],
              "max": [
                39.7281,
                -26.1562,
                982.843380952381
              ]
            },
            "file": "lower_back/asi-lower-back-lumbar-spine-FJ3165.glb",
            "sourceLabel": "fourth lumbar vertebra"
          },
          {
            "meshName": "FJ3168",
            "fma": {
              "conceptId": "13076",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:13076",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": null
            },
            "laterality": "midline",
            "geometry": {
              "triangles": 356,
              "sourceTriangles": 3892,
              "reduction": 0.9085,
              "units": "mm"
            },
            "bounds": {
              "min": [
                -47.66909999999999,
                -97.57953,
                905.3575454545455
              ],
              "max": [
                49.5736,
                -18.39635,
                952.2636491228068
              ]
            },
            "file": "lower_back/asi-lower-back-lumbar-spine-FJ3168.glb",
            "sourceLabel": "fifth lumbar vertebra"
          }
        ]
      }
    },
    {
      "asiId": "asi:lower-back.iliopsoas",
      "meshName": null,
      "region": "lower_back",
      "subRegionIds": [
        "lower_back.left_paravertebral",
        "lower_back.right_paravertebral"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Iliopsoas",
      "layTerm": "the deep hip flexor muscle, feels deep near the spine",
      "laterality": "left",
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
        "triangles": 186,
        "sourceTriangles": 7762,
        "reduction": 0.976,
        "units": "mm"
      },
      "bounds": {
        "min": [
          15.028059500000001,
          -126.02170312499996,
          734.7658240000003
        ],
        "max": [
          125.84468253968254,
          -51.245813758389296,
          1098.74
        ]
      },
      "file": null,
      "composite": {
        "selectable": false,
        "reason": "the source has no iliopsoas concept but models iliacus and psoas major separately, each per side",
        "components": [
          {
            "meshName": "FJ1422M",
            "fma": {
              "conceptId": "22323",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:22323",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": null
            },
            "laterality": "left",
            "geometry": {
              "triangles": 122,
              "sourceTriangles": 2862,
              "reduction": 0.9574,
              "units": "mm"
            },
            "bounds": {
              "min": [
                75.09680000000002,
                -126.02170312499996,
                734.7658240000003
              ],
              "max": [
                125.84468253968254,
                -51.245813758389296,
                957.991
              ]
            },
            "file": "lower_back/asi-lower-back-iliopsoas-FJ1422M.glb",
            "sourceLabel": "left iliacus"
          },
          {
            "meshName": "FJ1431M",
            "fma": {
              "conceptId": "22343",
              "status": "unverified",
              "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
            },
            "source": {
              "dataset": "BodyParts3D",
              "release": "4.0",
              "conceptId": "FMA:22343",
              "archive": "isa_BP3D_4.0_obj_99.zip",
              "doi": "10.18908/lsdba.nbdc00837-000",
              "retrievedAt": null
            },
            "laterality": "left",
            "geometry": {
              "triangles": 64,
              "sourceTriangles": 4900,
              "reduction": 0.9869,
              "units": "mm"
            },
            "bounds": {
              "min": [
                15.028059500000001,
                -107.61997023809516,
                752.8960531250003
              ],
              "max": [
                99.97833625000001,
                -59.29568820224718,
                1098.74
              ]
            },
            "file": "lower_back/asi-lower-back-iliopsoas-FJ1431M.glb",
            "sourceLabel": "left psoas major"
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
export const CANONICAL_ASSET_ROOT = '/anatomy/lower_back/left/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = 'left' as const;

/** The region this build represents, so a caller cannot mix scenes. */
export const CANONICAL_REGION = 'lower_back' as const;
