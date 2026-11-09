# Topological naming

A fillet, chamfer, shell or push/pull picks edges or faces of a body. When an earlier step changes (a sketch gets
wider, a hole is added before it) OpenCascade renumbers every edge and face, so a pick stored as a number can land
on the wrong one. BetterCad stores each pick by **name** as well as by number (#47).

## How faces get names

| Where the face came from | Its name |
| --- | --- |
| Swept from a sketch curve by an extrude or revolve | `side(<curve id>)` |
| The ends of an extrude or revolve | `cap.start`, `cap.end` |
| A primitive (box, cylinder…), an import or a catalogue part | `f<n>`, OpenCascade's fixed order |
| A tool's face, added by a join or cut | `<step id>:<the tool's name>`, e.g. `slot:side(l3)` |
| A fillet or chamfer round an edge | `fillet(<edge>)`, `chamfer(<edge>)` |
| A shell's inner wall | `shell(<face>)` |
| Anything else a step makes | `<step id>:new` |

Names follow each step through OpenCascade's history (`Modified`, `Generated`, `IsDeleted`), so a face trimmed by a
cut keeps its name. When a face is split, or two faces share a name, they become `name#1`, `name#2`… ordered by where
each one's middle is (x, then y, then z).

An **edge** is named by the faces either side of it, sorted: `cap.end|side(l1)`. A seam on a round face is
`seam(<face>)`. Two edges between the same pair of faces get `#1`, `#2` the same way.

## How a step finds its picks again

On every rebuild (in the kernel worker, `occt/naming.ts`):

1. The same name: done.
2. Gone, but the face was split or joined since: the name before the `#k` (`cap.end#2` finds the 2nd `cap.end#…`, or
   `cap.end` when it is whole again).
3. Still gone: the number it was picked with.

Steps 2 and 3 mark the step _recovered_: the timeline says which steps to check ("Fillet 1 picks edges or faces that
an earlier step changed"), and double-clicking one opens it to pick again.

## Limits

- Models saved before names existed have numbers only; they work as before, and gain names when a step is picked
  again.
- Imported meshes and bodies with more than 600 faces aren't named; their steps use numbers.
- A sketch curve that's deleted and drawn again gets a new id, so faces swept from it are new faces.
