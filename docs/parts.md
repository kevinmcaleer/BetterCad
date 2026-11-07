# Robot parts and reference bodies

Epic #167: drop in the servos, motors, boards and sensors a robot uses, design mounts round them, and cut their pockets in one click.

## Reference bodies (#185)

A reference body is there to design around: a servo you're making a bracket for, or an STL of a part you already own. It shows in the view, see-through and tinted in the accent colour, but it never prints.

- Turn it on with **Reference** in Properties, **Make a reference** on the right-click menu, or the **Reference or printed** command.
- **File > Import as a reference…** brings in an STL, STEP or 3MF file as reference bodies straight away.
- Reference bodies are left out of STL, 3MF and STEP export, the bed fit check, overhang and thin-wall checks, orientation suggestions, the print weight and the fits check. Choosing only reference bodies in Export says so.
- Measure, snapping and sketch projection still work on them, so you can size a mount from the real part.
- `printed()` in `packages/kernel/src/document.ts` is the one test for "does this body print": not hidden, not a hole, not a reference.

Later, a robot's links (#164) will count a reference body's datasheet mass, and the clash check (#165) can include it.
