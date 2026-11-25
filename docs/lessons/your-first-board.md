---
title: Your first board
course: Learn BetterCad
lesson: 13
minutes: 15
start: samples/pico-servo-board.bcad
answer: samples/pico-servo-board.bcad
---

# Your first board

You will take the Pico servo board sample apart and put a piece of it back: look at how a finished board is made,
then add a part of your own to the schematic, bring it onto the board, route it, check it and get the files to
order it. It takes about 15 minutes.

The steps are written for the lesson player (#239): each `##` heading is a step, `bettercad:` links open a tool, and
the comment under a step says how the player knows it is done. Until the player is built, read it as a page and
follow along in the app.

## Open the sample

Choose the [Electronics](bettercad:tab/electronics) tab, then Schematic. On the empty schematic, choose Open the
sample board.

The sample is a carrier for a Raspberry Pi Pico that runs a small rover: two rows of sockets for the Pico, a motor
driver with a 2 pin header for each motor, two 3 pin headers for servos, a socket for I2C sensors, a 2 pin header
for 5 V in with a power switch, a capacitor to steady the supply and a power LED with its resistor.

<!-- done: sample pico-servo-board -->

## Read the schematic

Press 1 for the [schematic](bettercad:view/schematic). Nothing here is joined by long wires. Each pin has a short
wire with a name on it: 5V, GND, SERVO1, SERVO2, MOTOR_A1. Wires with the same name are one net, wherever they are on the
sheet.

Click the resistor R1. The card on the right shows its value (1 kΩ), its package and its pins. Click the LED D1 and
see that its other end is on GND.

Press E for the [rules check](bettercad:tool/electronics.checks). It is clean. The blue crosses on the Pico's
sockets mark pins left open on purpose.

<!-- done: card checks -->

## Add a second LED

You will light an LED from the first servo signal, so you can see it pulse.

1. Press P for [Components](bettercad:tool/electronics.components). Type "led", pick LED with the 0805 package and
   choose Place. Click an empty spot under D1. Press Esc.
2. Press P again, type "1k", pick the resistor in 0805 and place it above the new LED.
3. Press W for [Wire](bettercad:tool/electronics.wire). Click the resistor's lower pin, then the LED's upper pin.
4. Press L for [Net label](bettercad:tool/electronics.label), type `SERVO1` and click the resistor's upper pin.
5. Press L again, type `GND` and click the LED's lower pin.

The status strip at the bottom says "Everything is connected" when no pin is left hanging.

<!-- done: parts 17 -->

## Bring it onto the board

The PCB tab now has a dot: the board is 2 changes behind the schematic. Choose
[Push to PCB](bettercad:tool/electronics.push). The card lists what it will do: add D2 and R2 beside the board. Choose
Update the board.

You are now in the PCB view. The two new parts sit beside the board, with thin lines to the pads they must join.

<!-- done: board parts 15 -->

## Place the new parts

Drag R2 and D2 onto the board, near the first servo header (J3). Press R to turn a part while it is picked. Keep
the thin lines short and uncrossed: a board that is easy to route is one where the parts were placed with care.

<!-- done: board placed 15 -->

## Route the tracks

Press W for [Route](bettercad:tool/electronics.pcb.route).

1. Click R2's pad on SERVO1, then the SERVO1 pin of J3. The track bends at 45° on its own. If it will not go where
   you point, something is in the way: the status strip says what.
2. Click R2's other pad, then D2's pad on the same net.
3. D2's last pad is on GND. The bottom of the board is one pour of ground copper, so you only need to reach it: click
   the pad, press V to drop a via beside it, and press Esc.

The strip at the bottom says "Every connection is routed" when you are done.

<!-- done: board routed -->

## Check the board

Press E for the [board check](bettercad:tool/electronics.pcb.checks). Fix anything it lists: click a line to go to
the spot. A gap that is too small usually means a track wants moving over; drag a track's corner, or delete the
track and lay it again.

<!-- done: board check clean -->

## See it in 3D

Press 3. The board stands on its printed base in the model, with your two new parts on it. Turn the view and look
underneath: this is how you check that a board fits its case before you order it.

<!-- done: view model -->

## Get the files

Press 2 to go back to the PCB view and choose [Order](bettercad:tool/electronics.pcb.order). Read the checklist,
choose Preview the files and look at the board from the top and from the bottom. Your new tracks are there, drawn
from the files a board house will read.

Choose Save the files. That zip is what you would upload. [Ordering a board](../electronics-ordering.md) says which
file goes where.

<!-- done: order saved -->

## What you learned

- A schematic says what is joined; names on wires keep it tidy.
- Push to PCB brings changes onto the board and tells you what they are first.
- Place with care, route by hand, pour ground, then let the board check find what you missed.
- The board is part of your model, so it can be checked against the parts you print.

Next, start a board of your own: New model, Electronics, Schematic, and press P.
