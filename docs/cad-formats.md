# CAD file formats

Research for the file formats epic (#152): what the common CAD formats hold, how they differ, which of their features
matter for BetterCad, and which formats BetterCad should open or import. Written 2026-11-07, against `main` after
epic #8 (`.bcad`, STL/3MF/STEP export, STL/3MF/STEP import).

## Summary

- There are two kinds of 3D file. **Mesh** files (STL, 3MF, OBJ) hold triangles: what a slicer needs, but a curve
  is only an approximation and there are no faces to fillet or push. **B-rep** files (STEP, IGES, BREP) hold the
  exact surfaces and edges: what another CAD tool needs.
- **STEP** is the one exchange format every CAD tool reads and writes. It carries exact solids, units, names,
  colours and assembly structure, but not the design history, sketches or joints.
- **Fusion 360** (`.f3d`) is closed and cloud-first; nothing outside Autodesk reads it. **FreeCAD** (`.FCStd`) is
  an open zip whose shapes are stored in OpenCascade's own BREP format, the same kernel BetterCad uses, so we can
  read its geometry exactly.
- Nobody exchanges parametric history between tools. Each tool's native file is a recipe only that tool can
  replay; everything else gets STEP for exact geometry or 3MF/STL for printing.
- Recommended next work (#152), in order: fix 3MF import (units, placements, multi-file projects), keep colours and the
  part tree through STEP and 3MF, a clear message for files we can't read, SVG and DXF into a sketch, OBJ import,
  FreeCAD import, IGES import. Skip joints, PMI and cross-tool history.

## Mesh and B-rep

|                    | Mesh (STL, 3MF, OBJ)                             | B-rep (STEP, IGES, BREP)                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------- |
| What it stores     | Triangles (OBJ: polygons)                        | Faces on exact surfaces (planes, cylinders, NURBS), edges, vertices and how they connect |
| A 10 mm hole       | 64 flat facets, say                              | One cylindrical face, radius 5 mm                       |
| Good for           | Slicers, viewers, games, scans                   | Editing in CAD, machining, fillets, measuring exactly   |
| Size               | Grows with resolution                            | Grows with complexity, not resolution                   |
| In BetterCad today | Imported as a mesh body: move, measure, combine; no fillet or push/pull | Imported as real solids that work with every tool |

Converting B-rep to mesh is easy and lossy (that's every STL export). Mesh to B-rep is not really possible: you
get a solid made of thousands of flat faces, which is what BetterCad does with STL today.

## STL

- Made by 3D Systems in 1987 for their stereolithography printers; still the default for printing.
- Just a list of triangles: each one is a normal and three corners. Binary STL is an 80-byte header, a triangle
  count, then 50 bytes per triangle. ASCII STL is the same data as text, about five times bigger.
- No units. By convention it's millimetres, but files from US tools are sometimes inches, so a part arrives
  25.4 times too small.
- No colours (some tools hide them in the two spare bytes per triangle; nothing agrees on how), no names, one body
  per file in practice, no curves, no guarantee the mesh is closed.
- BetterCad: exports binary STL from the exact solid at a chosen resolution; imports ASCII and binary.

## STEP

STEP is ISO 10303, "Standard for the Exchange of Product model data". The file most tools write is a plain text
file (ISO 10303-21, "Part 21", `.step` or `.stp`) that starts `ISO-10303-21;` and lists numbered entities:

```text
#10 = CARTESIAN_POINT('', (0., 0., 5.));
#11 = CYLINDRICAL_SURFACE('', #12, 5.);
#20 = ADVANCED_FACE('', (#21), #11, .T.);
#40 = MANIFOLD_SOLID_BREP('Bracket', #41);
```

The meaning of the entities is set by an **application protocol** (AP), named in the header:

| AP    | Year             | Adds                                                                         |
| ----- | ---------------- | ---------------------------------------------------------------------------- |
| AP203 | 1994             | Exact solids and assemblies for mechanical parts; colours from edition 2     |
| AP214 | 2001             | Automotive design: colours, layers, names, more geometry. The most common one |
| AP242 | 2014, since revised | Merges 203 and 214, adds PMI (tolerances, notes on the model), tessellated (mesh) shapes, kinematics |

BetterCad writes AP214, which every tool reads. AP242 would only matter for PMI, which we don't model.

What STEP carries: exact solids, surfaces and wires; units (the file declares mm or inch, and OpenCascade converts);
names; colours and layers; assembly structure; and in AP242, tolerances and a mesh alongside the B-rep. What it
doesn't carry: the design history, sketches with their constraints, parameters, joints in practice, or the original
tool's feature tree.

### STEP parts and assemblies

A STEP file describes **products**. A part is a product with a shape. An assembly is a product whose shape is made
of other products, each placed with a transform:

```text
PRODUCT('Bolt M3x10', …)                      a part, defined once
PRODUCT('Hinge', …)                           an assembly
NEXT_ASSEMBLY_USAGE_OCCURRENCE('Bolt:1', …, Hinge, Bolt, …)   use the bolt in the hinge
NEXT_ASSEMBLY_USAGE_OCCURRENCE('Bolt:2', …, Hinge, Bolt, …)   and again, placed elsewhere
```

- The part's shape is stored once and **instanced**: four identical bolts are one shape and four placements.
- Assemblies nest, so a file is a tree: product, sub-assemblies, parts.
- Most tools write the whole tree into one file. STEP can also reference other STEP files (one file per part,
  like SolidWorks does natively), but that's rare in downloads.
- Moving parts don't survive. AP214 and AP242 define kinematics, but almost no tool writes or reads them, so a
  Fusion assembly with joints arrives as parts frozen where they were.
- A "STEP part" file has one product and one or more solids; a "STEP assembly" file has the tree. Both are the same
  format, and a reader that only asks for "all the solids" (what BetterCad does today) flattens an assembly into
  loose bodies and loses the names and colours.

BetterCad today: export writes each body as a named product with OpenCascade's XCAF (extended data framework)
writer, `STEPCAFControl_Writer`. Import uses the plain `STEPControl_Reader`, which gives shapes only. The
`replicad-opencascadejs` build we use has no `STEPCAFControl_Reader`, so reading names, colours and the tree needs
the trimmed custom build (#43) to add it.

## 3MF

- Made by the 3MF Consortium (Microsoft, Autodesk, HP, Ultimaker and others) in 2015 as STL's replacement for
  printing. Bambu Studio, PrusaSlicer, OrcaSlicer and Cura all use it, and slicers save their projects as 3MF.
- A zip of XML. `3D/3dmodel.model` holds meshes as shared vertices and triangles, so it's smaller than STL and
  always says which edges join.
- Has units (micron to metre), names, colours and materials, and **components**: an object can be made of other
  objects with transforms, which is a small assembly tree with instancing. A build section places objects on the
  plate.
- Extensions add multi-file models (Production), textures and per-triangle colours (Materials), lattices (Beam
  Lattice) and slices. Slicer projects add their own settings in `Metadata/`, which other slicers ignore.
- BetterCad today: exports one named object per body in mm. Import reads every mesh in the first `.model` file,
  but ignores the unit, the build and component transforms, and the other model files a slicer project
  (Production extension) splits objects into. So a Bambu or Prusa project imports with parts missing or at the
  origin, and an inch 3MF imports at the wrong size.

## Fusion 360 and FreeCAD

|                        | Fusion 360 (`.f3d`)                                         | FreeCAD (`.FCStd`)                                          |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Where files live       | Autodesk's cloud; `.f3d` is an export of one design         | Files on disk                                               |
| What the file is       | An archive of Autodesk's own binary streams; no public spec | A zip: `Document.xml`, `GuiDocument.xml`, one `.brp` per shape, a thumbnail |
| Geometry kernel        | Autodesk Shape Manager (descended from ACIS)                | OpenCascade, the same as BetterCad                          |
| Geometry in the file   | Exact, in Autodesk's own encoding                           | Exact, in OpenCascade BREP text, readable as is             |
| History                | A linear timeline of features, like BetterCad's             | A dependency graph of objects with properties and expressions; no single timeline |
| Parameters             | User parameters with expressions                            | Properties, expressions and spreadsheets                     |
| Sketches               | Constrained sketches                                        | Sketcher, constraints in `Document.xml`                     |
| Parts and assemblies   | One design holds components (with bodies and sketches) and occurrences (instances); joints (rigid, revolute, slider, ball and others) move them | Bodies and `App::Part` containers; `App::Link` for instances, also across files; Assembly workbench (built in since 1.0, 2024) adds joints |
| Several files          | Linked components point at other cloud designs; `.f3z` bundles a design with its links | Links to other `.FCStd` files on disk                       |
| Look and colour        | Appearances and physical materials                          | Colours per shape and face in `GuiDocument.xml`             |
| Licence                | Proprietary, free for personal use with limits              | LGPL, open source                                           |
| Exports                | STEP, IGES, SAT, STL, OBJ, 3MF, DXF (sketches) and more      | STEP, IGES, BREP, STL, OBJ, 3MF, DXF, SVG and more          |

What this means for BetterCad:

- **We can't open `.f3d`.** There is no spec and no open reader. Ask Fusion users to export STEP (File, Export,
  STEP), and say so when someone drops an `.f3d`.
- **We can read FreeCAD geometry exactly.** Unzip, find the shape files of the visible objects in `Document.xml`,
  read each with OpenCascade's `BRepTools::Read` (in our WASM build today), take colours from `GuiDocument.xml`.
  Sketches and history would need a translator per FreeCAD object type; not worth it.
- **Our model is closer to Fusion's.** A linear timeline, constrained sketches, parameters. FreeCAD's graph doesn't
  map onto a timeline.
- **Neither history survives a move between tools**, and neither will ours: `.bcad` holds only the steps and
  rebuilds geometry, so only BetterCad can open it. That's normal; STEP is how CAD tools talk.

## Other formats

| Format         | Kind                  | Notes                                                                                   |
| -------------- | --------------------- | --------------------------------------------------------------------------------------- |
| OBJ            | Mesh, text            | Wavefront, 1990s. Polygons, normals, UVs; colours via a `.mtl` side file. No units. Common on model sites and from scanners and Blender |
| PLY            | Mesh                  | Stanford. Vertex colours; mostly 3D scans                                               |
| AMF            | Mesh, XML             | ISO/ASTM 52915. Colours, materials, curved triangles. Never caught on; 3MF won           |
| glTF / GLB     | Mesh, scene           | Khronos. The web's 3D format; metres and Y up, so needs converting. For viewing, not printing |
| IGES           | B-rep, mostly surfaces | 1980, last revised 1996. Older CAD and CNC shops. Often trimmed surfaces rather than solids, so they need sewing. Not in our WASM build |
| BREP           | B-rep                 | OpenCascade's own format. Exact, trivial for us to read and write; only OCCT tools use it |
| Parasolid (`.x_t`, `.x_b`) | B-rep     | Siemens' kernel: SolidWorks, Onshape, NX, Solid Edge. Closed; no open reader             |
| ACIS (`.sat`, `.sab`) | B-rep          | Spatial's kernel. Closed, versions differ; no open reader                                 |
| SolidWorks (`.sldprt`, `.sldasm`), Inventor (`.ipt`, `.iam`), CATIA (`.CATPart`), Creo (`.prt`), Onshape | Native | Proprietary history files. Only commercial translators read them; their users can export STEP |
| SVG            | 2D vector             | Logos, text, laser-cut shapes. Paths of lines, arcs and Béziers; units vary (px, mm)     |
| DXF            | 2D (and 3D) vector    | AutoCAD's exchange format. Laser cutting, CNC, drawings, sketches exported from Fusion. Documented text format |
| DWG            | 2D/3D native          | AutoCAD's closed native format. Only via a commercial or reverse-engineered library      |
| OpenSCAD (`.scad`) | Code              | A script that builds a model. Needs the OpenSCAD engine to run                          |
| PNG, JPG       | Image                 | A reference picture behind a sketch, or a height map (lithophanes)                      |

## Features: importance and recommendation

Importance is for BetterCad's users: people making things to 3D print. Status is `main` today.

| Feature                          | Carried by                         | Importance | Status in BetterCad                     | Recommendation |
| -------------------------------- | ---------------------------------- | ---------- | --------------------------------------- | -------------- |
| Exact solids (B-rep)             | STEP, IGES, BREP, FCStd            | Critical   | STEP in and out                         | Have. Add FreeCAD and IGES import |
| Triangle meshes                  | STL, 3MF, OBJ, PLY, AMF            | Critical   | STL and 3MF in and out                  | Have. Fix 3MF import; add OBJ |
| Units                            | STEP, 3MF, AMF, IGES               | Critical   | STEP converts; 3MF unit ignored on import | Read the 3MF unit. For unitless STL and OBJ, spot a model that looks like inches and offer to scale |
| Several bodies in one file       | STEP, 3MF, OBJ, FCStd              | Critical   | In and out                              | Have           |
| Body names                       | STEP, 3MF, OBJ, FCStd              | High       | Out; STEP import loses product names    | Keep names on STEP import (needs the XCAF reader in #43) |
| Placement of parts               | STEP, 3MF, FCStd                   | High       | 3MF transforms ignored on import        | Apply 3MF build and component transforms |
| Colours                          | STEP (AP214+), 3MF, OBJ, PLY, FCStd | High      | Looks aren't exported                   | Write body colours to 3MF and STEP; read them on import. Multi-colour printers (AMS, MMU) start from 3MF colours |
| 2D outlines into a sketch        | SVG, DXF                           | High       | None                                    | Import SVG and DXF as sketch curves (logos, text, laser-cut parts) |
| Clear message for closed formats | n/a                                | High       | "BetterCad opens .bcad, .stl, .step and .3mf files" | Name the tool and say how to export STEP from it |
| Assembly tree on import          | STEP, 3MF components, FCStd        | Medium     | Flattened to loose bodies               | Keep the tree as named groups of bodies; expand instances into copies |
| Instances (one part, many places) | STEP, 3MF, FCStd links            | Medium     | None                                    | On import, copy. In BetterCad, pattern features cover most needs; native instances later |
| Assembly tree on export          | STEP, 3MF                          | Medium     | Flat list of bodies                     | Later, once BetterCad has components or groups |
| Sketch export (DXF, SVG)         | DXF, SVG                           | Medium     | None                                    | Later: laser cutters want it, printers don't |
| Slicer project data              | 3MF (vendor metadata)              | Medium     | Ignored                                 | Read the meshes and placements from slicer projects; ignore settings. Never write vendor settings |
| Materials and density            | 3MF, STEP (AP242), FCStd           | Low        | None                                    | Later, with mass and print-time estimates (v2) |
| Textures                         | 3MF, OBJ, glTF                     | Low        | None                                    | Skip           |
| Parametric history between tools | None in practice                   | Low (impossible) | `.bcad` only                      | Skip. STEP is the hand-off; say so in the docs |
| Constrained sketches from other tools | FCStd, f3d                    | Low        | None                                    | Skip; each tool's constraints differ    |
| Joints and motion                | f3d, FCStd, STEP kinematics (rarely) | Low      | None                                    | Skip; prints don't move in the file     |
| PMI, tolerances, GD&T            | STEP AP242                         | Low        | None                                    | Skip            |
| Embedded exact geometry in `.bcad` | n/a                              | Low        | Steps only                              | Skip for now; export STEP when someone needs geometry |

## Formats to open or import

The curated list, in recommended order. "Kind" says what it becomes in BetterCad.

| Format              | Extensions          | Kind it becomes            | Why                                                | Effort | Recommendation |
| ------------------- | ------------------- | -------------------------- | -------------------------------------------------- | ------ | -------------- |
| BetterCad           | `.bcad`             | The model                  | Native                                             | Done   | Have           |
| STEP                | `.step`, `.stp`     | Solids                     | The CAD exchange format                            | Done; tree and colours need #43 | Have; improve |
| STL                 | `.stl`              | Mesh body                  | Every printable download                           | Done   | Have           |
| 3MF                 | `.3mf`              | Mesh bodies                | Modern slicers and their projects                  | Done; units and placements to fix | Have; fix now |
| SVG                 | `.svg`              | Sketch                     | Logos, text, outlines; Tinkercad users expect it   | Medium (JS)  | Add, v2 |
| DXF                 | `.dxf`              | Sketch                     | Laser-cut parts, Fusion sketch exports, drawings   | Medium (JS)  | Add, v2 |
| OBJ                 | `.obj` (+ `.mtl`)   | Mesh body                  | Scans, Blender, model sites                        | Small (JS)   | Add, v2 |
| FreeCAD             | `.FCStd`            | Solids                     | The other free CAD tool; exact via BREP            | Medium       | Add, v2 |
| IGES                | `.igs`, `.iges`     | Solids (sewn surfaces)     | Older CAD, machine shops                           | Medium (WASM build, #43) | Add, v2, after #43 |
| BREP                | `.brep`, `.brp`     | Solids                     | Free with FreeCAD import; OCCT users               | Tiny         | Add with FreeCAD |
| PLY                 | `.ply`              | Mesh body                  | 3D scans                                           | Small (JS)   | Later |
| AMF                 | `.amf`              | Mesh bodies                | Old Slic3r and Cura files                          | Small (JS)   | Later |
| glTF / GLB          | `.gltf`, `.glb`     | Mesh bodies                | Web 3D models                                      | Small (three.js has a loader) | Later |
| PNG, JPG            | `.png`, `.jpg`      | Reference image or height map | Trace a picture; lithophanes                    | Medium       | Later |
| OpenSCAD            | `.scad`             | Solids                     | Thingiverse customisers                            | Large (OpenSCAD WASM) | Skip for now |
| Fusion 360          | `.f3d`, `.f3z`      | n/a                        | Closed                                             | n/a          | Skip; show how to export STEP |
| SolidWorks, Inventor, CATIA, Creo, Solid Edge, NX | `.sldprt`, `.sldasm`, `.ipt`, `.iam`, `.CATPart`, `.prt`, `.par` | n/a | Closed | n/a | Skip; show how to export STEP |
| Parasolid, ACIS     | `.x_t`, `.x_b`, `.sat`, `.sab` | n/a             | Closed kernels                                     | n/a          | Skip; ask for STEP |
| DWG                 | `.dwg`              | n/a                        | Closed                                             | n/a          | Skip; ask for DXF |

Export, for reference: STL, 3MF and STEP are done. Worth adding later: colours in 3MF and STEP (in the epic), DXF
and SVG of a sketch or a flat face for laser cutting, and OBJ or GLB only if someone asks.

## Sources

- ISO 10303-21 (Part 21 clear text), ISO 10303-203, -214, -242; the CAx Implementor Forum's recommended practices
  for assembly structure and colours.
- 3MF Core Specification and the Materials, Production and Beam Lattice extensions (3mf.io).
- FreeCAD wiki: "File Format FCStd", "App Link", "Assembly Workbench" (1.0).
- Autodesk Fusion help: export formats, components and joints.
- OpenCascade 7.x docs: STEP translator, XDE (XCAF), `BRepTools`.
- This repo: `packages/kernel/src/occt/imports.ts`, `export.ts`, `export/mesh.ts` (`read3mf`), and the
  class list in `replicad-opencascadejs@1.2.1`'s typings.
