# Third-party licences

BetterCad's own code is MIT. These libraries keep their own licences. The WASM builds are shipped as separate, unmodified files, so you can swap them for your own build.

| Library | Used for | Licence | Source |
| --- | --- | --- | --- |
| OpenCascade Technology (via replicad-opencascadejs 1.2.1, an opencascade.js build) | The modelling kernel (epic #4) | LGPL 2.1 with the OCCT exception | https://dev.opencascade.org/resources/licensing, https://github.com/sgenoud/replicad, https://github.com/donalffons/opencascade.js |
| planegcs (FreeCAD's sketch solver, @salusoft89/planegcs 1.3.0) | Sketch constraints (epic #5) | LGPL 2.0 or later | https://github.com/Salusoft89/planegcs |
| opentype.js 1.3.4 | Reading fonts for the sketch Text tool | MIT | https://github.com/opentypejs/opentype.js |
| Inter, Archivo Black, JetBrains Mono, Allerta Stencil (via Fontsource, Latin subset) | Sketch Text tool fonts | SIL Open Font License 1.1 | https://github.com/fontsource/font-files |
| Roboto Slab (via Fontsource, Latin subset) | Sketch Text tool font | Apache 2.0 | https://github.com/fontsource/font-files |
| three.js | The 3D view (epic #3) | MIT | https://github.com/mrdoob/three.js |
| React, React DOM | The interface | MIT | https://github.com/facebook/react |
| FastAPI, Starlette, Pydantic, Uvicorn | The server | MIT / BSD-3-Clause | https://github.com/fastapi/fastapi |
| ngspice (via eecircuit-engine 1.9.0, an ngspice build for the browser) | Circuit simulation in the electronics workspace (#761) | ngspice: modified BSD; eecircuit-engine: MIT | https://ngspice.sourceforge.io/, https://github.com/eelab-dev/EEcircuit-engine |
| KiCad libraries 9.0.0 (symbols and footprints, converted to BetterCad's format) | The electronics starter parts (epic #606) | CC-BY-SA 4.0 with the KiCad libraries exception | https://www.kicad.org/libraries/license/, https://gitlab.com/kicad/libraries |

The OCCT WASM ships as `assets/replicad_single-*.wasm`; see `packages/kernel/VERSIONS.md` to swap it. planegcs ships as `assets/planegcs-*.wasm`. ngspice ships as `assets/sim/eecircuit-engine-*.js`, the package's own file, copied unchanged.

## Every runtime dependency

<!-- generated: npm run licences -->

| Package | Version | Licence | From |
| --- | --- | --- | --- |
| @fontsource/allerta-stencil | 5.3.0 | OFL-1.1 | npm |
| @fontsource/archivo-black | 5.3.0 | OFL-1.1 | npm |
| @fontsource/inter | 5.3.0 | OFL-1.1 | npm |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 | npm |
| @fontsource/roboto-slab | 5.3.0 | Apache-2.0 | npm |
| @salusoft89/planegcs | 1.3.0 | LGPL-2.0-or-later | npm |
| @types/dom-webcodecs | 0.1.19 | MIT | npm |
| @types/wicg-file-system-access | 2020.9.8 | MIT | npm |
| eecircuit-engine | 1.9.0 | MIT | npm |
| js-tokens | 4.0.0 | MIT | npm |
| loose-envify | 1.4.0 | MIT | npm |
| mp4-muxer | 5.2.2 | MIT | npm |
| opentype.js | 1.3.4 | MIT | npm |
| react | 18.3.1 | MIT | npm |
| react-dom | 18.3.1 | MIT | npm |
| replicad-opencascadejs | 1.2.1 | LGPL-2.1-only | npm |
| scheduler | 0.23.2 | MIT | npm |
| string.prototype.codepointat | 0.2.1 | MIT | npm |
| three | 0.180.0 | MIT | npm |
| three-gpu-pathtracer | 0.0.24 | MIT | npm |
| three-mesh-bvh | 0.9.18 | MIT | npm |
| tiny-inflate | 1.0.3 | MIT | npm |
| webm-muxer | 5.1.4 | MIT | npm |
| xatlas-web | 0.1.0 | MIT | npm |
| annotated-doc | 0.0.5 | MIT | PyPI |
| annotated-types | 0.8.0 | MIT | PyPI |
| anyio | 4.16.0 | MIT | PyPI |
| click | 8.5.0 | BSD-3-Clause | PyPI |
| fastapi | 0.162.0 | MIT | PyPI |
| h11 | 0.16.0 | MIT | PyPI |
| httptools | 0.9.0 | MIT | PyPI |
| idna | 3.20 | BSD-3-Clause | PyPI |
| opentelemetry-api | 1.45.2 | Apache-2.0 | PyPI |
| pydantic | 2.14.3 | MIT | PyPI |
| pydantic-core | 2.50.4 | MIT | PyPI |
| pydantic-settings | 2.16.2 | MIT | PyPI |
| python-dotenv | 1.2.4 | BSD-3-Clause | PyPI |
| pyyaml | 6.0.3 | MIT | PyPI |
| starlette | 1.10.0 | BSD-3-Clause | PyPI |
| typing-extensions | 4.16.0 | PSF-2.0 | PyPI |
| typing-inspection | 0.4.5 | MIT | PyPI |
| uvicorn | 0.54.0 | BSD-3-Clause | PyPI |
| uvloop | 0.23.0 | MIT | PyPI |
| watchfiles | 1.3.0 | MIT | PyPI |
| websockets | 17.4 | BSD-3-Clause | PyPI |

<!-- end generated -->

## Part libraries

The electronics starter library is taken from the KiCad libraries, converted to BetterCad's format. It stays under their licence, CC-BY-SA 4.0, whose exception says the boards and files you make with the parts are yours, with no share-alike. If you pass the library itself on, keep the licence and the credit. See `packages/electronics/library/CREDITS.md`.

<!-- generated: part libraries -->

| Pack | Parts | From | Version | Licence | Source |
| --- | --- | --- | --- | --- | --- |
| BetterCad starter library | 224 | KiCad libraries | 9.0.0 | CC-BY-SA 4.0 with exception | https://www.kicad.org/libraries/license/ |
| BetterCad starter library | 4 | BetterCad |  | CC-BY-SA 4.0 | https://bettercad.kevsrobots.com |

<!-- end generated -->
