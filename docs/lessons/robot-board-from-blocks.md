---
title: Build a robot board from blocks
course: Learn BetterCad
lesson: 14
minutes: 15
start: none
answer: samples/robot-blocks.bcad
---

# Build a robot board from blocks

You will build the power and motor circuit for a small robot without drawing a single resistor: a USB-C socket that
charges a LiPo cell, a 5 V supply for the Pico and two servos, a 3.3 V supply for a Qwiic sensor, and a driver for
two motors. Each of those is a block, and you join the blocks together. It takes about 15 minutes.

The steps are written for the lesson player (#239): each `##` heading is a step, `bettercad:` links open a tool, and
the comment under a step says how the player knows it is done. Until the player is built, read it as a page and
follow along in the app.

## Place the Pico

Choose the [Electronics](bettercad:tab/electronics) tab, then Schematic. Press P for
[Components](bettercad:tool/electronics.components), type "pico", pick Raspberry Pi Pico and choose Place. Click the
middle of the sheet, then press Esc.

<!-- done: part pico -->

## Place the power blocks

In Components, choose Blocks. The Power shelf has the circuits that make and share out power.

1. Pick USB-C power in. Read what it does and what it needs, choose Place and click to the left of the Pico.
2. Do the same with LiPo charger, LiPo protection, 5 V boost from a LiPo and 3.3 V regulator. Put them in a column
   to the left, in that order.

Each block lands in an outline with its name on top. The small labels on the outline are its points: power in on
top, ground at the bottom, inputs on the left and outputs on the right. Drag an outline to move the whole block.

<!-- done: blocks usb-c-power lipo-charger lipo-protect boost-5v reg-3v3-linear -->

## Join the power

Pick the USB-C block. Its card lists its points: 5V is Open. Choose Connect to… beside it and pick the charger's 5V.
A wire joins them.

Join the rest the same way:

- the charger's BAT+ to the protection block's B+
- the protection block's B+ to the boost's VIN
- the boost's 5V to the regulator's VIN, and to the Pico's VSYS

Ground joins by itself: every block's GND point is one net.

Press Ctrl+Z if a wire goes to the wrong place. Connect to… only offers points it is safe to join, so a 5 V output
is never offered to a 3.3 V input.

<!-- done: joined boost-5v.5V pico.VSYS -->

## Add the cell

Place a JST PH 2 pin connector (type "jst ph") beside the protection block. Wire pin 1 to the protection block's B+
and pin 2 to its B-. This is where the LiPo cell plugs in.

<!-- done: part jst-ph-2 -->

## Add a sensor socket

From the Connectors shelf, place Qwiic / STEMMA QT connector under the regulator. Join its 3V3 to the regulator's 3V3. Then pick
the Qwiic block and choose Join I2C: it joins SDA and SCL to the Pico's first free I2C pair in one step.

<!-- done: joined qwiic.SDA pico -->

## Drive the motors and servos

From the Motors shelf, place Two DC motors (DRV8833) and Four servo headers to the right of the Pico.

1. Join the driver's VM and the servo headers' V+ to the boost's 5V. The servos and motors take their power straight
   from the boost, not through the Pico.
2. Join the driver's SLEEP to the regulator's 3V3, to keep it awake.
3. Join AIN1, AIN2, BIN1 and BIN2 to Pico pins GP2 to GP5 (pins 4 to 7), and the servo headers' S1 and S2 to GP6 and
   GP7 (pins 9 and 10).
4. Place two DC motors (type "motor") and wire each to A+ and A-, or B+ and B-, on the driver.

<!-- done: joined drv8833.VM servo-headers.V+ -->

## Check it

Press E for the [rules check](bettercad:tool/electronics.checks). If a Needed point is still open, the check says
which block and which point; click the line to go there. When it only lists the Pico's unused pins, press Q and
click each one to mark it Not connected on purpose.

Pick a block and choose Fold to a box on its card. Its inside folds away and its points stay: the sheet now reads as
eight boxes round a Pico. Double-click a box to open it again.

<!-- done: checks clean -->

## Push it to a board

Choose Push to PCB, then press 2 for the [PCB](bettercad:view/pcb). Each block's parts arrive together, set out
the way its datasheet suggests, inside an outline with the block's name. Pick a part and choose Pick the group to
move a whole block at once.

Compare with the sample: on an empty schematic, choose Open a board made from blocks.

<!-- done: board -->
