/**
 * GENERATED FILE. DO NOT EDIT.
 *
 * Produced by scripts/embed-anatomy-manifest.mjs from
 * assets/anatomy/generated/manifest.json.
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
      "meshName": "FJ1468M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Clavicular part of deltoid",
      "layTerm": "the front part of the shoulder muscle, near the collarbone",
      "laterality": "left",
      "fma": {
        "conceptId": "34681",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:34681",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 178,
        "sourceTriangles": 2206,
        "reduction": 0.9193,
        "units": "unitless"
      },
      "bounds": {
        "min": [
          92.09425116279067,
          -118.48878571428573,
          1210.1771212121212
        ],
        "max": [
          201.48139999999998,
          -75.28415000000001,
          1355.39
        ]
      },
      "file": "shoulder/asi-shoulder-deltoid-clavicular-part.glb"
    },
    {
      "asiId": "asi:shoulder.deltoid-acromial-part",
      "meshName": "FJ1467M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior",
        "shoulder.lateral"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Acromial part of deltoid",
      "layTerm": "the middle part of the shoulder muscle, over the shoulder blade",
      "laterality": "left",
      "fma": {
        "conceptId": "34683",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:34683",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
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
        "units": "unitless"
      },
      "bounds": {
        "min": [
          149.80036781609198,
          -103.18866666666666,
          1207.668518518518
        ],
        "max": [
          226.53452380952388,
          -41.7602,
          1349.22
        ]
      },
      "file": "shoulder/asi-shoulder-deltoid-acromial-part.glb"
    },
    {
      "asiId": "asi:shoulder.deltoid-spinal-part",
      "meshName": "FJ1513M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Spinal part of deltoid",
      "layTerm": "the back part of the shoulder muscle",
      "laterality": "left",
      "fma": {
        "conceptId": "34685",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:34685",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 238,
        "sourceTriangles": 1900,
        "reduction": 0.8747,
        "units": "unitless"
      },
      "bounds": {
        "min": [
          86.82131884057968,
          -78.41628867924526,
          1192.3386363636364
        ],
        "max": [
          218.2607142857143,
          -2.72512,
          1339.84
        ]
      },
      "file": "shoulder/asi-shoulder-deltoid-spinal-part.glb"
    },
    {
      "asiId": "asi:shoulder.supraspinatus-tendon",
      "meshName": "FJ1506M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.lateral"
      ],
      "layer": "tendon",
      "anatomicalLabel": "Supraspinatus tendon",
      "layTerm": "the tendon that runs over the top of the shoulder joint",
      "laterality": "left",
      "fma": {
        "conceptId": "32545",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32545",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
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
        "units": "unitless"
      },
      "bounds": {
        "min": [
          66.34561470588238,
          -89.88746249999998,
          1308.5826000000002
        ],
        "max": [
          188.443,
          -15.113728723404265,
          1340.2755555555555
        ]
      },
      "file": "shoulder/asi-shoulder-supraspinatus-tendon.glb"
    },
    {
      "asiId": "asi:shoulder.infraspinatus",
      "meshName": "FJ1500M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Infraspinatus",
      "layTerm": "the muscle on the shoulder blade below the spine of the blade",
      "laterality": "left",
      "fma": {
        "conceptId": "32548",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32548",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
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
        "units": "unitless"
      },
      "bounds": {
        "min": [
          60.798984090909066,
          -75.8612,
          1207.24
        ],
        "max": [
          189.05,
          3.42368,
          1329.282222222222
        ]
      },
      "file": "shoulder/asi-shoulder-infraspinatus.glb"
    },
    {
      "asiId": "asi:shoulder.teres-minor",
      "meshName": "FJ1508M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Teres minor",
      "layTerm": "a small muscle at the outer edge of the shoulder blade",
      "laterality": "left",
      "fma": {
        "conceptId": "32554",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:32554",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 164,
        "sourceTriangles": 506,
        "reduction": 0.6759,
        "units": "unitless"
      },
      "bounds": {
        "min": [
          108.67011475409838,
          -76.83677647058825,
          1222.9221311475414
        ],
        "max": [
          188.68338235294124,
          -12.4567,
          1316.92
        ]
      },
      "file": "shoulder/asi-shoulder-teres-minor.glb"
    },
    {
      "asiId": "asi:shoulder.subscapularis",
      "meshName": "FJ1504M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Subscapularis",
      "layTerm": "a deep muscle right in front of the shoulder joint",
      "laterality": "left",
      "fma": {
        "conceptId": "13415",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:13415",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 228,
        "sourceTriangles": 2092,
        "reduction": 0.891,
        "units": "unitless"
      },
      "bounds": {
        "min": [
          64.58584901960785,
          -96.37916228571423,
          1199.0975213675222
        ],
        "max": [
          161.18292920353983,
          -3.6494347200000026,
          1324.8
        ]
      },
      "file": "shoulder/asi-shoulder-subscapularis.glb"
    },
    {
      "asiId": "asi:shoulder.trapezius-upper",
      "meshName": "FJ1520M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Upper trapezius",
      "layTerm": "the muscle from the neck to the top of the shoulder",
      "laterality": "left",
      "fma": {
        "conceptId": "33583",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:33583",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 150,
        "sourceTriangles": 10530,
        "reduction": 0.9858,
        "units": "unitless"
      },
      "bounds": {
        "min": [
          -1.111120075757576,
          -43.592502531645536,
          1060.420984848485
        ],
        "max": [
          145.39043037974685,
          19.971680000000003,
          1342.97
        ]
      },
      "file": "shoulder/asi-shoulder-trapezius-upper.glb"
    },
    {
      "asiId": "asi:shoulder.scapula",
      "meshName": "FJ3279",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.posterior"
      ],
      "layer": "bone",
      "anatomicalLabel": "Scapula",
      "layTerm": "the shoulder blade bone",
      "laterality": "left",
      "fma": {
        "conceptId": "13396",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:13396",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 344,
        "sourceTriangles": 28106,
        "reduction": 0.9878,
        "units": "unitless"
      },
      "bounds": {
        "min": [
          61.482157999999984,
          -96.80690282542879,
          1188.3917215189877
        ],
        "max": [
          163.43441595441584,
          2.991317468918918,
          1349.86
        ]
      },
      "file": "shoulder/asi-shoulder-scapula.glb"
    },
    {
      "asiId": "asi:shoulder.biceps-long-head-tendon",
      "meshName": "FJ1478M",
      "region": "shoulder",
      "subRegionIds": [
        "shoulder.anterior"
      ],
      "layer": "tendon",
      "anatomicalLabel": "Long head of biceps tendon",
      "layTerm": "the tendon that runs down the front of the shoulder joint",
      "laterality": "left",
      "fma": {
        "conceptId": "37687",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:37687",
        "archive": "isa_BP3D_4.0_obj_99.zip",
        "doi": "10.18908/lsdba.nbdc00837-000",
        "retrievedAt": "2026-10-01"
      },
      "licence": {
        "id": "CC-BY-4.0",
        "name": "Creative Commons Attribution 4.0 International",
        "url": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
        "attribution": "BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International",
        "verifiedOn": "2025-02-27"
      },
      "geometry": {
        "triangles": 22,
        "sourceTriangles": 1426,
        "reduction": 0.9846,
        "units": "unitless"
      },
      "bounds": {
        "min": [
          138.53315625,
          -95.16774285714287,
          1007.3197333333336
        ],
        "max": [
          223.97964242424246,
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

/** Where the generated geometry is served from, matching `assetRoot` in the adapter. */
export const CANONICAL_ASSET_ROOT = '/anatomy/';
