# Changelog

BetterCad follows [semantic versioning](https://semver.org). Each release's image is on GHCR as
`ghcr.io/kevinmcaleer/bettercad:<version>`.

## Unreleased: v1.0.0

The first public release: free CAD for 3D printing in your browser.

### Modelling

- Sketches with constraints and dimensions, solved by planegcs: lines, arcs, circles, rectangles and polygons, with
  expressions such as `20 / 2` in any dimension (#5).
- Extrude, push and pull, revolve, fillet, chamfer and shell, on OpenCascade running in a Web Worker (#4, #6).
- Shapes (box, cylinder, sphere, cone, torus, wedge), moving and turning parts, and join, cut and intersect (#6).
- Holes sized for printing: screw sizes, clearance, tap and heat-set insert fits, a printer hole offset and a
  calibration coupon (#11).
- A parametric timeline: edit any earlier step, roll back, and drive the model from named parameters (#7).

### Viewing

- A view cube, iso, front, side and top views, section views, line art, and selection of faces, edges and bodies (#3).
- Light, Dark and Holodeck themes, every text pair at 4.5:1 or better (#2).

### Files and accounts

- The `.bcad` format, STL, 3MF and STEP export, and STL, 3MF and STEP import (#8).
- Optional accounts: save to your account with version history, share a view-only link, and a library of your
  models (#9).
- Works offline as an installable app; the first-run tour and samples, including the phone stand (#10).

### Printing

- Overhang and thin-wall checks, orientation suggestions and "Lay it on the bed" (#11).

### Quality and launch

- Kernel, sketch and timeline goldens, a nightly run of every sample and fixture, end-to-end journeys and
  screenshot tests (#106, #107).
- Performance budgets in CI for the bundle, the WASM, the kernel and the viewport, and a Lighthouse check (#108).
- Report a problem from the Help menu or the crash banner (#109).
- A Help menu with keyboard shortcuts, the tour, the Learn BetterCad course and About (#110).
- Privacy and terms pages, page-count analytics with no cookies or personal data, and a generated list of every
  runtime dependency's licence (#111).
