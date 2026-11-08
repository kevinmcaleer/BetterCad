# Gears and drives

Epic #168: gears, racks and pulleys made from their settings, as steps you can change later.

## Spur gears (#191)

Pick **Spur gear** in the model tools, then click the ground or a flat face. The gear stands there as one **Gear** step, and the bar changes it live:

- **Teeth** and **Module** size it. The module is the pitch diameter over the teeth, so 20 teeth at module 1 is 20 mm across the pitch circle (the bar shows it) and 22 mm outside. Two gears mesh only with the same module and pressure angle.
- **Width** is how tall it stands.
- **Bore**: none, round, a **D-flat** for a motor shaft (the flat's distance from the centre), or a **Servo horn**: a hole for the horn's hub and four M2 arm holes on a cross.
- **More**: pressure angle (20° standard), backlash, tip clearance and profile shift as shares of the module, and a hub on top round the bore.
- Below 17 teeth at 20° the root is undercut and weak. The bar says so; profile shift (try 0.3 to 0.5) fixes it.

Backlash thins each tooth along the pitch circle and starts at your printer's press fit (#166), so two gears with the same backlash have twice that between them.

Click again on the same plane to move the gear. **Edit gear** on the timeline opens the bar again. The gear keeps its "Gear 20T" name in step with its teeth until you rename it.

### How it's made

`packages/kernel/src/gears.ts` does the maths without OCCT: the flank is the involute of the base circle, below that a radial run and a root fillet tangent to the root circle. Each flank is drawn as two circular arcs through five points on the involute, within a few microns of the true curve (tested), so a 20-tooth gear is about 200 faces. `gearSpec()` in `document.ts` turns the step into a prism with its hub joined and bore cut.

The issue asked for the profile as an editable sketch step. It's one Gear step instead: the settings stay editable and the outline regenerates from them, without a sketch full of curves you'd never edit by hand.

Goldens: `gear-20t-m1`, `gear-12t-shifted-dflat-hub` and `gear-40t-horn`. Unit tests check tooth thickness at the pitch circle, the outside diameter m(z + 2), the area of a 20-tooth module 1 gear and the arcs against the involute.

## Meshing two gears (#192)

- Right-click a gear and pick **Add mating gear**. A new gear stands beside it, meshed, with the bar open: set its teeth and the bar shows the ratio ("2 : 1, the small gear turns twice as fast"). Click to move it round the first gear, or type its **Angle**.
- Or pick two gears and use **Mesh gears**: the later one moves beside the earlier, on the side it was on. Gears with different modules or pressure angles are refused with a plain message.
- A meshed gear follows its partner: change the partner's teeth, place or turn and it stays meshed, at the centre distance m(z1 + z2)/2 (plus any profile shift) and turned so its teeth fall between the partner's. It takes the partner's module and pressure angle. **Unmesh** leaves it where it is, free.
- The tests build pairs in OCCT and check the solids don't overlap, and that half a tooth's turn would make them clash.

Hinge joints at both centres and a drive link between them wait for joints (#164) and drive links (#194).

## Racks and GT2 pulleys (#193)

The Gear tool's bar switches the step between **Spur gear**, **Rack** and **GT2 pulley**.

- **Rack**: module, length, height (solid under the roots) and width, with pressure angle, backlash and clearance under More. The teeth are straight-flanked, πm apart, one centred on the rack's middle. Right-click a spur gear and pick **Add rack** for one that runs against it: its pitch line touches the gear's pitch circle, slid so a gap meets the gear's tooth, and it follows the gear like a mating gear. The bar shows how far it moves for one turn of the gear.
- **GT2 pulley**: teeth, **6 mm** or **9 mm belt** (the teeth are 1 mm wider than the belt), **Flanges** (1 mm discs 1.5 mm proud), bore and hub. The pitch diameter is 2z/π (12.73 mm for 20 teeth) and the outside 0.254 mm in from it each side. Each groove has the belt tooth's 0.555 mm round bottom, 0.75 mm deep, opening to about 1.5 mm across. That's a close fit to the GT2 profile for printing, not Gates' exact curve.
- **Fit a belt**: pick two pulleys and it puts the stock GT2 belt nearest what they need on them, then moves the later pulley along the line between them so that belt fits exactly. Edit that pulley to pick another stock belt from the **Belt** menu (it moves to suit), type its angle, or **Take off belt**.

Goldens: `rack-m1-60` and `gt2-20t-flanged`. Tests check the rack's tooth pitch and thickness, a rack against 20- and 13-tooth gears (no overlap, and a clash when slid half a tooth), the pulley's pitch diameter and size with flanges, belt lengths both ways, and fitting a stock belt.
