# Third-party licences

BetterCad's own code is MIT. These libraries keep their own licences. The WASM builds are shipped as separate, unmodified files, so you can swap them for your own build.

| Library | Used for | Licence | Source |
| --- | --- | --- | --- |
| OpenCascade Technology (via replicad-opencascadejs 1.2.1, an opencascade.js build) | The modelling kernel (epic #4) | LGPL 2.1 with the OCCT exception | https://dev.opencascade.org/resources/licensing, https://github.com/sgenoud/replicad, https://github.com/donalffons/opencascade.js |
| planegcs (FreeCAD's sketch solver, @salusoft89/planegcs 1.3.0) | Sketch constraints (epic #5) | LGPL 2.0 or later | https://github.com/Salusoft89/planegcs |
| three.js | The 3D view (epic #3) | MIT | https://github.com/mrdoob/three.js |
| React, React DOM | The interface | MIT | https://github.com/facebook/react |
| FastAPI, Starlette, Pydantic, Uvicorn | The server | MIT / BSD-3-Clause | https://github.com/fastapi/fastapi |

The OCCT WASM ships as `assets/replicad_single-*.wasm`; see `packages/kernel/VERSIONS.md` to swap it. planegcs ships as `assets/planegcs-*.wasm`.

## Every runtime dependency

<!-- generated: npm run licences -->

| Package | Version | Licence | From |
| --- | --- | --- | --- |
| @salusoft89/planegcs | 1.3.0 | LGPL-2.0-or-later | npm |
| js-tokens | 4.0.0 | MIT | npm |
| loose-envify | 1.4.0 | MIT | npm |
| react | 18.3.1 | MIT | npm |
| react-dom | 18.3.1 | MIT | npm |
| replicad-opencascadejs | 1.2.1 | LGPL-2.1-only | npm |
| scheduler | 0.23.2 | MIT | npm |
| three | 0.180.0 | MIT | npm |
| three-gpu-pathtracer | 0.0.24 | MIT | npm |
| three-mesh-bvh | 0.9.18 | MIT | npm |
| xatlas-web | 0.1.0 | MIT | npm |
| annotated-doc | 0.0.5 | MIT | PyPI |
| annotated-types | 0.8.0 | MIT | PyPI |
| anyio | 4.16.0 | MIT | PyPI |
| argon2-cffi | 25.1.0 | MIT | PyPI |
| argon2-cffi-bindings | 26.1.0 | MIT | PyPI |
| cffi | 2.1.1 | MIT-0 | PyPI |
| click | 8.5.0 | BSD-3-Clause | PyPI |
| fastapi | 0.162.0 | MIT | PyPI |
| h11 | 0.16.0 | MIT | PyPI |
| httptools | 0.9.0 | MIT | PyPI |
| idna | 3.20 | BSD-3-Clause | PyPI |
| opentelemetry-api | 1.45.2 | Apache-2.0 | PyPI |
| pycparser | 3.12 | BSD-3-Clause | PyPI |
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
