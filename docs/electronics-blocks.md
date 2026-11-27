# Circuit blocks

A block is a small circuit, drawn and checked, that you place on a schematic and join to the rest of your design
(epic #765). How to use them is in the [guide](electronics-guide.md#build-from-blocks); how they are built is in
[electronics.md](electronics.md). The lesson [Build a robot board from blocks](lessons/robot-board-from-blocks.md)
puts eight of them round a Raspberry Pi Pico.

Every block follows its main chip's datasheet application circuit, and uses only parts in the starter library, so
it can be pushed to a board and ordered. Its points are on the outline: power in on top, ground at the bottom,
inputs on the left and outputs on the right. A point marked Needed must be joined for the block to work, and the
rules check says so when one is open.

The list below is the starter shelf, `packages/electronics/src/library/blocks.ts`. A change to a block there raises
its `version` and adds a line to `changes`; designs that use the old one then show an Update tag
(`library/blockVersions.ts` is kept in step by a test).

## Power

| Block | What it does | Needs | Points | Follows |
| --- | --- | --- | --- | --- |
| 3.3 V regulator | Turns 4.5 to 12 V into a steady 3.3 V for a microcontroller and sensors, up to about 800 mA. | 4.5 to 12 V in. It gets warm when the drop is big: use the buck block from a battery pack above 7 V. | VIN, 3V3, GND | [AMS1117 datasheet, typical application](http://www.advanced-monolithic.com/pdf/ds1117.pdf) |
| 3.3 V buck regulator | Turns up to 32 V into 3.3 V without getting hot, up to 2 A. Good from a 2S or 3S battery pack. | 3.8 to 32 V in. | VIN, 3V3, GND | [AP63203 datasheet, typical application circuit](https://www.diodes.com/assets/Datasheets/AP63200-AP63201-AP63203-AP63205.pdf) |
| 5 V boost from a LiPo | Raises one LiPo cell (3 to 4.2 V) to 5 V for servos, LEDs or a USB device. | 2 to 4.2 V in. A single cell gives about 1 A at 5 V. | VIN, 5V, GND | [MT3608 datasheet, typical application](https://www.olimex.com/Products/Breadboarding/BB-PWR-3608/resources/MT3608.pdf) |
| LiPo charger | Charges one LiPo cell from USB 5 V, with a red light while charging and a green one when full. | 5 V in (USB). Charges at about 580 mA: change R1 for a different current (1.2 kΩ is 1 A). | 5V, BAT+, GND | [TP4056 datasheet, typical application](https://www.lcsc.com/datasheet/lcsc_datasheet_2410121619_TOPPOWER-Nanjing-Extension-Microelectronics-TP4056-42-ESOP8_C16581.pdf) |
| LiPo protection | Cuts the battery off before it is drained too far, charged too high or shorted. Keeps a LiPo cell safe. | One LiPo cell. The rest of the board's ground is P-, not the cell's minus. | B+, B-, P- (GND) | [DW01A datasheet, typical application](https://hmsemi.com/downfile/DW01A.PDF) |
| USB-C power in | A USB-C socket that asks the charger for 5 V. Without the two 5.1 kΩ resistors most USB-C chargers give nothing. | A USB-C charger or computer port. | 5V, D+, D-, GND | [USB Type-C specification, sink with Rd on CC](https://www.usb.org/sites/default/files/documents/usb_type-c.zip) |
| Reverse battery protection | Stops a battery plugged in the wrong way round from damaging the board, with almost no voltage lost. | Up to 12 V in and up to about 3 A. | BAT+, OUT, GND | [AO3401A datasheet (P-channel MOSFET as an ideal diode)](http://www.aosmd.com/pdfs/datasheet/AO3401A.pdf) |

## Motors

| Block | What it does | Needs | Points | Follows |
| --- | --- | --- | --- | --- |
| Two DC motors (DRV8833) | Drives two small DC motors forwards and backwards from four pins of your microcontroller. | 2.7 to 10.8 V for the motors, up to 1.2 A each. Logic from 3.3 V or 5 V. | VM, SLEEP, AIN1, AIN2, BIN1, BIN2, FAULT, A+, A-, B+, B-, GND | [DRV8833 datasheet, typical application](http://www.ti.com/lit/ds/symlink/drv8833.pdf) |
| Two DC motors (TB6612FNG) | Drives two DC motors with a direction pair and a speed pin each. A little more current than the DRV8833. | 4.5 to 13.5 V for the motors, up to 1.2 A each. 2.7 to 5.5 V logic. | VM, VCC, STBY, PWMA, AIN1, AIN2, PWMB, BIN1, BIN2, A+, A-, B+, B-, GND | [TB6612FNG datasheet, application circuit](https://toshiba.semicon-storage.com/us/product/linear/motordriver/detail.TB6612FNG.html) |
| Stepper motor driver socket | A socket for an A4988 or DRV8825 stepper driver board. Two pins step and turn a NEMA 17 stepper. | 8 to 35 V for the motor, 3.3 V or 5 V logic. Set the current with the trimmer on the driver board. | VMOT, VDD, STEP, DIR, EN, 1A, 1B, 2A, 2B, GND | [Pololu A4988 carrier, minimal wiring](https://www.pololu.com/product/1182) |
| Four servo headers | Plugs for four hobby servos with a big capacitor so the board does not reset when they all move. | 5 to 6 V for the servos, about 1 A each when they move. Signals from 3.3 V or 5 V pins. | V+, S1, S2, S3, S4, GND | [Hobby servo wiring: signal, +, -](http://forums.parallax.com/uploads/attachments/46831/74481.png) |
| MOSFET switch | Turns a motor, solenoid, pump or LED strip on and off (or dims it) from one 3.3 V pin. | Up to 30 V and about 3 A for the load. | V+, IN, LOAD+, LOAD-, GND | [AO3400A datasheet, logic-level N-channel MOSFET](http://www.aosmd.com/pdfs/datasheet/AO3400A.pdf) |

## Connectors

| Block | What it does | Needs | Points | Follows |
| --- | --- | --- | --- | --- |
| Qwiic / STEMMA QT connector | A small 4-pin socket for I2C sensors and displays from SparkFun, Adafruit and Pimoroni. Plug and play. | 3.3 V and an I2C bus (SDA and SCL). | 3V3, SDA, SCL, GND | [SparkFun Qwiic connector pinout: GND, 3.3 V, SDA, SCL](https://www.sparkfun.com/qwiic) |
| Serial debug header | Four pins for a USB serial adapter, to see your program's messages or load code. | A 3.3 V USB serial adapter. Its TX goes to your RX, and RX to TX. | 3V3, TX, RX, GND | [Common 4-pin serial header: GND, RX, TX, 3.3 V](https://learn.sparkfun.com/tutorials/serial-communication) |

## Sensors and signals

| Block | What it does | Needs | Points | Follows |
| --- | --- | --- | --- | --- |
| I2C level shifter | Lets a 3.3 V microcontroller talk I2C to a 5 V sensor or display safely. | 3.3 V and 5 V. Works for I2C and other slow two-way lines. | 3V3, 5V, SDA 3V3, SCL 3V3, SDA 5V, SCL 5V | [Philips AN97055, bi-directional level shifter for I2C](https://www.onsemi.com/pub/Collateral/BSS138-D.PDF) |
| 8-way level shifter | Eight lines between 3.3 V and 5 V parts, either way: for displays, encoders and other boards. | The low voltage (1.2 to 3.6 V) on A, the high one (1.65 to 5.5 V) on B. Not for I2C pull-ups or strong loads. | VA, VB, A1, A2, A3, A4, A5, A6, A7, A8, B1, B2, B3, B4, B5, B6, B7, B8, GND | [TXS0108E datasheet, typical application](https://www.ti.com/lit/ds/symlink/txs0108e.pdf) |
| NeoPixel start | The first NeoPixel (WS2812B) of a chain, with the 5 V signal boost and capacitor it needs from a 3.3 V board. | 5 V, about 60 mA per pixel at full white. One data pin. | 5V, DIN, DOUT, GND | [Adafruit NeoPixel Überguide, best practices](https://cdn-shop.adafruit.com/datasheets/WS2812B.pdf) |
| Battery voltage monitor | Halves the battery voltage so an analogue pin can read how full the battery is. | A battery up to 6.6 V for a 3.3 V ADC. Use a bigger top resistor for more. | VBAT, ADC, GND | [Voltage divider: VOUT = VIN × R2 / (R1 + R2)](https://learn.sparkfun.com/tutorials/voltage-dividers) |
| Button and status light | A push button that reads low when pressed, and an LED your program can turn on. | 3.3 V. One input pin and one output pin. | 3V3, LED, BTN, GND | [Pull-up resistor with RC debounce, LED with series resistor](https://learn.sparkfun.com/tutorials/pull-up-resistors) |

## Your own blocks

Pick a group's card, then Save as block. Name it, say what it does, and tick the labels that are its points: each
gets a kind (power in, power out, input, output, both ways, ground) and, if it takes power, its voltage. It goes on
the Your blocks shelf, kept in this browser and with your account. Export saves a `.bcblock.json` file; Open a block file
on the Blocks tab adds one somebody shared. Saving the same block again makes a new version, and the copies already
placed show an Update tag.
