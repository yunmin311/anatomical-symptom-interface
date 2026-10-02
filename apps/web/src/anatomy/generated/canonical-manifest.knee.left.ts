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
    "knee"
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
      "asiId": "asi:knee.patella",
      "meshName": "FJ3275",
      "region": "knee",
      "subRegionIds": [
        "knee.anterior"
      ],
      "layer": "bone",
      "anatomicalLabel": "Patella",
      "layTerm": "the kneecap",
      "laterality": "left",
      "fma": {
        "conceptId": "24487",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:24487",
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
        "sourceTriangles": 310,
        "reduction": 0.4129,
        "units": "mm"
      },
      "bounds": {
        "min": [
          60.5925,
          -122.751,
          362.35100000000006
        ],
        "max": [
          102.224,
          -101.055,
          400.489
        ]
      },
      "file": "knee/asi-knee-patella.glb"
    },
    {
      "asiId": "asi:knee.popliteus",
      "meshName": "FJ1430M",
      "region": "knee",
      "subRegionIds": [
        "knee.lateral"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Popliteus",
      "layTerm": "the muscle at the back of the knee that unlocks it",
      "laterality": "left",
      "fma": {
        "conceptId": "22592",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:22592",
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
        "triangles": 82,
        "sourceTriangles": 858,
        "reduction": 0.9044,
        "units": "mm"
      },
      "bounds": {
        "min": [
          57.987225,
          -90.33914897959184,
          266.0011224489797
        ],
        "max": [
          107.85950000000003,
          -48.308499999999995,
          406.611
        ]
      },
      "file": "knee/asi-knee-popliteus.glb"
    },
    {
      "asiId": "asi:knee.iliotibial-band",
      "meshName": "FJ1423M",
      "region": "knee",
      "subRegionIds": [
        "knee.lateral"
      ],
      "layer": "fascia",
      "anatomicalLabel": "Iliotibial band",
      "layTerm": "the thick band down the outside of the thigh to the shin",
      "laterality": "left",
      "fma": {
        "conceptId": "58777",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:58777",
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
        "triangles": 52,
        "sourceTriangles": 17172,
        "reduction": 0.997,
        "units": "mm"
      },
      "bounds": {
        "min": [
          100.40468388654203,
          -102.78113541666664,
          332.86823114061576
        ],
        "max": [
          159.04004294478526,
          -41.4780628504673,
          945.152
        ]
      },
      "file": "knee/asi-knee-iliotibial-band.glb"
    },
    {
      "asiId": "asi:knee.gastrocnemius-head",
      "meshName": "FJ1397M",
      "region": "knee",
      "subRegionIds": [
        "knee.posterior"
      ],
      "layer": "muscle",
      "anatomicalLabel": "Gastrocnemius (inner head)",
      "layTerm": "the calf muscle just above the back of the knee",
      "laterality": "left",
      "fma": {
        "conceptId": "45958",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:45958",
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
        "triangles": 124,
        "sourceTriangles": 3842,
        "reduction": 0.9677,
        "units": "mm"
      },
      "bounds": {
        "min": [
          27.150292307692308,
          -88.8331,
          133.6522595419847
        ],
        "max": [
          65.37666322580647,
          -17.284246153846155,
          432.102
        ]
      },
      "file": "knee/asi-knee-gastrocnemius-head.glb"
    },
    {
      "asiId": "asi:knee.popliteal-artery",
      "meshName": "FJ2086",
      "region": "knee",
      "subRegionIds": [
        "knee.posterior"
      ],
      "layer": "vessel",
      "anatomicalLabel": "Popliteal artery",
      "layTerm": "the main artery at the back of the knee",
      "laterality": "left",
      "fma": {
        "conceptId": "77381",
        "status": "unverified",
        "note": "BodyParts3D 4.3i concept list; not yet checked against FMA Explorer"
      },
      "source": {
        "dataset": "BodyParts3D",
        "release": "4.0",
        "conceptId": "FMA:77381",
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
        "triangles": 56,
        "sourceTriangles": 16732,
        "reduction": 0.9967,
        "units": "mm"
      },
      "bounds": {
        "min": [
          60.579507955077204,
          -91.16501665886761,
          286.1875928074245
        ],
        "max": [
          95.59922255639094,
          -54.3027275862069,
          480.775
        ]
      },
      "file": "knee/asi-knee-popliteal-artery.glb"
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
export const CANONICAL_ASSET_ROOT = '/anatomy/knee/left/';

/** The side this build represents, as a fact carried in the manifest itself. */
export const CANONICAL_SIDE = 'left' as const;

/** The region this build represents, so a caller cannot mix scenes. */
export const CANONICAL_REGION = 'knee' as const;
