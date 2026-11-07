# Third-party licences

BetterCad's own code is MIT. These libraries keep their own licences. The WASM builds are shipped as separate, unmodified files, so you can swap them for your own build.

| Library | Used for | Licence | Source |
| --- | --- | --- | --- |
| OpenCascade Technology (via replicad-opencascadejs 1.2.1, an opencascade.js build) | The modelling kernel (epic #4) | LGPL 2.1 with the OCCT exception | https://dev.opencascade.org/resources/licensing, https://github.com/sgenoud/replicad, https://github.com/donalffons/opencascade.js |
| planegcs (FreeCAD's sketch solver) | Sketch constraints (epic #5) | LGPL 2.1 | https://github.com/Salusoft89/planegcs |
| three.js | The 3D view (epic #3) | MIT | https://github.com/mrdoob/three.js |
| React, React DOM | The interface | MIT | https://github.com/facebook/react |
| FastAPI, Starlette, Pydantic, Uvicorn | The server | MIT / BSD-3-Clause | https://github.com/fastapi/fastapi |

The OCCT WASM ships as `assets/replicad_single-*.wasm`; see `packages/kernel/VERSIONS.md` to swap it. planegcs arrives with epic #5.
