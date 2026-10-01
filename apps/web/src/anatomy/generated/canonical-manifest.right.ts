/**
 * GENERATED FILE. DO NOT EDIT.
 *
 * Produced by scripts/embed-anatomy-manifest.mjs from
 * assets/anatomy/generated/<side>/manifest.json.
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
    "shoulder"
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
      "asiId": "asi:shoulder.deltoid-clavicular-part",
      "meshName": "FJ1468",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Clavicular part of deltoid",
      "layTerm": "the front part of the shoulder muscle, near the collarbone",
      "laterality": "right",
      "fma": {
        "conceptId": "34680",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:34680",
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
        "sourceTriangles": 2206,
        "reduction": 0.9248,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -201.4812,
          -119.29046153846153,
          1210.1778787878786
        ],
        "max": [
          -91.27122575757575,
          -75.39473333333335,
          1355.39
        ]
      },
      "file": "shoulder/asi-shoulder-deltoid-clavicular-part.glb"
    },
    {
      "asiId": "asi:shoulder.deltoid-acromial-part",
      "meshName": "FJ1467",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior",
        "shoulder.lateral"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Acromial part of deltoid",
      "layTerm": "the middle part of the shoulder muscle, over the shoulder blade",
      "laterality": "right",
      "fma": {
        "conceptId": "34682",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:34682",
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
        "sourceTriangles": 1300,
        "reduction": 0.8477,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -224.8327083333334,
          -102.568,
          1208.4093548387095
        ],
        "max": [
          -148.77969230769233,
          -41.96295714285714,
          1349.22
        ]
      },
      "file": "shoulder/asi-shoulder-deltoid-acromial-part.glb"
    },
    {
      "asiId": "asi:shoulder.deltoid-spinal-part",
      "meshName": "FJ1513",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Spinal part of deltoid",
      "layTerm": "the back part of the shoulder muscle",
      "laterality": "right",
      "fma": {
        "conceptId": "34684",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:34684",
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
        "triangles": 244,
        "sourceTriangles": 1900,
        "reduction": 0.8716,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -218.2607142857143,
          -78.41628301886792,
          1192.306730769231
        ],
        "max": [
          -86.82120434782607,
          -2.72512,
          1339.84
        ]
      },
      "file": "shoulder/asi-shoulder-deltoid-spinal-part.glb"
    },
    {
      "asiId": "asi:shoulder.supraspinatus-tendon",
      "meshName": "FJ1506",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.lateral"
      ],
      "layer": "tendon",
      "anatomicalLabel": "Supraspinatus tendon",
      "layTerm": "the tendon that runs over the top of the shoulder joint",
      "laterality": "right",
      "fma": {
        "conceptId": "32544",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32544",
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
        "triangles": 126,
        "sourceTriangles": 878,
        "reduction": 0.8565,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -186.0728666666667,
          -89.88746249999998,
          1308.5866
        ],
        "max": [
          -63.876,
          -15.074999999999998,
          1340.2766666666666
        ]
      },
      "file": "shoulder/asi-shoulder-supraspinatus-tendon.glb"
    },
    {
      "asiId": "asi:shoulder.infraspinatus",
      "meshName": "FJ1500",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Infraspinatus",
      "layTerm": "the muscle on the shoulder blade below the spine of the blade",
      "laterality": "right",
      "fma": {
        "conceptId": "32547",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32547",
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
        "triangles": 182,
        "sourceTriangles": 866,
        "reduction": 0.7898,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -187.7897169811321,
          -73.46691000000008,
          1207.24
        ],
        "max": [
          -60.2584,
          3.42368,
          1329.282222222222
        ]
      },
      "file": "shoulder/asi-shoulder-infraspinatus.glb"
    },
    {
      "asiId": "asi:shoulder.teres-minor",
      "meshName": "FJ1508",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Teres minor",
      "layTerm": "a small muscle at the outer edge of the shoulder blade",
      "laterality": "right",
      "fma": {
        "conceptId": "32553",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32553",
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
        "triangles": 156,
        "sourceTriangles": 506,
        "reduction": 0.6917,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -188.6731428571429,
          -76.72517142857146,
          1222.767966101695
        ],
        "max": [
          -108.50493220338984,
          -12.4567,
          1316.92
        ]
      },
      "file": "shoulder/asi-shoulder-teres-minor.glb"
    },
    {
      "asiId": "asi:shoulder.subscapularis",
      "meshName": "FJ1504",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Subscapularis",
      "layTerm": "a deep muscle right in front of the shoulder joint",
      "laterality": "right",
      "fma": {
        "conceptId": "13414",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:13414",
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
        "triangles": 232,
        "sourceTriangles": 2092,
        "reduction": 0.8891,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -161.15677192982454,
          -96.42367192982451,
          1198.9314159292044
        ],
        "max": [
          -64.58389612903225,
          -3.6431627906976773,
          1324.8
        ]
      },
      "file": "shoulder/asi-shoulder-subscapularis.glb"
    },
    {
      "asiId": "asi:shoulder.trapezius-upper",
      "meshName": "FJ1520",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Upper trapezius",
      "layTerm": "the muscle from the neck to the top of the shoulder",
      "laterality": "right",
      "fma": {
        "conceptId": "33581",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:33581",
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
        "triangles": 208,
        "sourceTriangles": 10530,
        "reduction": 0.9802,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -130.24252617079878,
          -27.18524421487608,
          1060.4209090909092
        ],
        "max": [
          1.111120075757576,
          20.399221276595743,
          1342.97
        ]
      },
      "file": "shoulder/asi-shoulder-trapezius-upper.glb"
    },
    {
      "asiId": "asi:shoulder.scapula",
      "meshName": "FJ3384",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "bone",
      "anatomicalLabel": "Scapula",
      "layTerm": "the shoulder blade bone",
      "laterality": "right",
      "fma": {
        "conceptId": "13395",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:13395",
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
        "triangles": 348,
        "sourceTriangles": 26172,
        "reduction": 0.9867,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -162.07587869822484,
          -96.9052031809145,
          1186.6782894736841
        ],
        "max": [
          -59.85935714285716,
          3.19313551682243,
          1349.86
        ]
      },
      "file": "shoulder/asi-shoulder-scapula.glb"
    },
    {
      "asiId": "asi:shoulder.biceps-long-head-tendon",
      "meshName": "FJ1478",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "tendon",
      "anatomicalLabel": "Long head of biceps tendon",
      "layTerm": "the tendon that runs down the front of the shoulder joint",
      "laterality": "right",
      "fma": {
        "conceptId": "37686",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:37686",
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
        "triangles": 24,
        "sourceTriangles": 1426,
        "reduction": 0.9832,
        "units": "mm"
      },
      "bounds": {
        "min": [
          -224.0059999999999,
          -95.64487027027027,
          1006.7431061452519
        ],
        "max": [
          -138.53315625,
          -69.90318124999999,
          1339.42
        ]
      },
      "file": "shoulder/asi-shoulder-biceps-long-head-tendon.glb"
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
export const CANONICAL_ASSET_ROOT = '/anatomy/right/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = 'right' as const;
