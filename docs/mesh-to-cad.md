# Turning a mesh into editable geometry

An STL or 3MF holds triangles, not faces: a hole is a ring of flat strips, so it can't be resized, and the body refuses
fillets and chamfers. Recognise features (epic #437) reads what the triangles were made from and builds an editable
copy. This first release makes holes editable.

## Using it

1. Import an STL or 3MF.
2. Right-click the body and choose **Recognise features…** (also in the command palette).
3. The panel lists the holes it found, grouped where they match ("4 × 3.4 mm holes, through, M3 clearance"), and
   draws their rims on the model. Untick any you want left alone. Click a rim in the view to tick or untick it.
4. **Convert** makes a new component, "name (editable)", with one Convert step and a Hole step for each group. The
   mesh stays in the model with its eye off.

The Hole steps are ordinary ones: change the size, add a counterbore, move a point, or delete the step and the hole
is gone. The editable body also takes fillets, chamfers and shells, which a mesh refuses.

If the mesh has been thinned out, repaired or scanned, set **Mesh** to Rough or Very rough to allow more slack.

## What it finds

| Shape | Found | Becomes |
| --- | --- | --- |
| Hole right through, or blind with a flat bottom | Yes | Hole step |
| Counterbore, countersink | Yes, on a clean mesh | Hole step with that head |
| Hole with a drill point | Yes | Hole step with a flat bottom |
| Hole starting on a curved or sloping face, or with more than one step | Listed with the reason | Left in the mesh |
| Six sides or fewer | No: that is a pocket, not a hole | Left in the mesh |
| Other round faces and round edges | Counted in the summary | Left as facets (chamfers and fillets come next, #444, #445) |

Recognition needs a mesh without gaps. One with gaps is refused with a message: repair it in a slicer first. A mesh
that is mostly sculpted (under a third of its surface flat or round) gets a note, since there is little to find.

## How it works

Recognition is plain TypeScript in `packages/kernel/src/recognise`, with no OCCT, and loads in the kernel worker the
first time the tool runs:

1. `mesh.ts` welds the loose triangles into one mesh with neighbours and gathers them into flat facets.
2. `holes.ts` finds round rims (a closed loop on a flat facet whose corners sit on a circle), then follows the wall
   from each rim: triangles whose corners lie on one straight line in height and radius about the rim's axis. A crease
   starts the next wall; a flat face square to the axis ends it as a shelf, an open end or a floor.
3. A chain of inward-facing walls from a rim is a hole. Its narrowest cylinder is the hole; a wider cylinder or a cone
   before it is the head.
4. `surfaces.ts` fits cylinders to what is left, for the summary.

The same triangles always give the same holes in the same order. Half a million triangles take about three seconds.

### Why "plug and re-cut"

The spike (#438) found that the OCCT build we ship (replicad-opencascadejs 1.2.1) has no defeaturing and no way to
swap a face's surface, so facets can't be replaced in place. Booleans are there, so Convert does this instead:

1. Sew the mesh into a solid, as import already does.
2. Fuse a cylinder into each chosen hole, 0.01 mm wider than the hole so it swallows the facets. On a test plate this
   took 187 faces down to 6.
3. The Hole steps then cut true cylinders, exactly as they do on any body.

The result is valid, its volume matches the part the mesh came from, and its faces get stable names, so later steps
can pick them. The Convert step stores the plugs it found, so a rebuild never runs recognition again.

## Tests

- `recognise/recognise.test.ts` is the scoring harness (#439): parts built in the kernel with known holes, meshed at
  three qualities, turned and shaken, scored for holes found, missed and false.
- `recognise/convert.test.ts` covers the Convert step and its Hole steps through the model builder.
- The `convert-mesh-hole` golden pins the plug and re-cut geometry.
- `web/e2e/recognise.spec.ts` imports a plate and converts it in the browser.
