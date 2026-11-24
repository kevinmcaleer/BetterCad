# Credits for the starter library

`starter.json` is the parts library BetterCad's electronics workspace starts with. It is built by `npm run library`
from `starter.manifest.json`, which names every part.

## KiCad libraries

Almost every symbol and footprint comes from the official KiCad libraries, release 9.0.0, converted to BetterCad's own
format (the shapes, pins and pads are theirs; the file format is ours):

- Symbols: https://gitlab.com/kicad/libraries/kicad-symbols
- Footprints: https://gitlab.com/kicad/libraries/kicad-footprints

They are the work of the KiCad librarians and the many people who contributed parts, and are licensed
[CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode) with an exception, set out at
https://www.kicad.org/libraries/license/:

> To the extent that the creation of electronic designs that use 'Licensed Material' can be considered to be 'Adapted
> Material', then the copyright holder waives article 3 of the license with respect to these designs and any generated
> files which use data provided as part of the 'Licensed Material'.

In plain words:

- **The boards you design with these parts are yours.** Schematics, board layouts, Gerber files and anything else you
  make with them carry no share-alike duty and need no credit line.
- **The library itself stays CC-BY-SA 4.0.** If you pass on `starter.json`, or a library you made by changing its
  parts, keep this licence and this credit with it.

What we changed: each part was converted from KiCad's s-expression files to BetterCad's JSON; names, starting values,
keywords and shelves were set in the manifest; a few footprints a symbol's pins do not fit were left out; text KiCad
keeps on a footprint (the reference and value) is drawn by BetterCad instead.

## BetterCad

- The simple 3D bodies (boxes, cylinders and pin-header shapes) are made by BetterCad from each footprint's outline.
- The module parts with no KiCad symbol (HC-SR04, SSD1306 I2C display, GY-521, VL53L0X breakout) are drawn by BetterCad.
  Their outlines are guides: check them against your own module.

These are shared under CC-BY-SA 4.0 too, so the whole pack has one licence. BetterCad's code is MIT.

This is a plain summary, not legal advice.
