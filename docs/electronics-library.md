# The electronics parts library

The electronics workspace (epic #606) starts with a library of the parts robot and maker boards use most: the starter
library (#624). This page says what is in it, where it comes from and how to change it. The model behind a part is in
[electronics.md](electronics.md).

## What a part is

A component (`ComponentDef` in `packages/electronics/src/model.ts`, #622) is:

| Piece | What it holds |
| --- | --- |
| Symbol | The drawing on the schematic and its pins: number, name and what the pin does (input, power in, passive) |
| Packages | One or more footprints the part comes in. A resistor has 0603, 0402, 0805, 1206 and through-hole |
| Pin map | Per package, which pads a pin joins when the numbers differ. With none, pin 3 joins pad 3 |
| 3D body | Per package: a simple box, cylinder or pin header for now; a STEP file or a BetterCad model later (#628) |
| Value and prefix | What a new part starts as ("10 kΩ") and its reference letter (R, C, U, J) |
| Supplier | Manufacturer, part number and LCSC number, used by the BOM and pick and place. Left empty until checked |
| Source | The library it came from and its licence, shown on the part's card and kept in the design |

A design keeps its own copy of every component it uses, so a model opens offline and never changes when a library does.
Changing a placed part's package is one field (`Part.pkg`); the next Push to PCB swaps the footprint and keeps the nets.

**The pin map check** (`checkPinMap`): in every package, each pin that shows on the symbol has a pad to land on. Pads no
pin uses are fine (mounting tabs, shields). The library build runs it on every part, and a package that fails is left
out and reported, never guessed at.

## Where the parts come from

The symbols and footprints are from the official KiCad libraries, release 9.0.0, converted to BetterCad's format.
They are CC-BY-SA 4.0 with an exception: **boards you make with the parts are yours**, with no share-alike and no
credit needed; the library itself keeps its licence and credit when it is passed on. The full credit is in
`packages/electronics/library/CREDITS.md`, in `THIRD_PARTY_LICENSES.md`, in Help → About, and on every part's card.

Four modules KiCad has no symbol for (HC-SR04, SSD1306 I2C display, GY-521, VL53L0X breakout) are drawn by BetterCad
(`packages/electronics/src/library/modules.ts`).

Not in yet, on purpose:

- **LCSC part numbers.** None are filled in. A wrong number orders the wrong part, so they will be added only from a
  checked list (#661).
- **Real 3D models.** Bodies are simple shapes sized from the footprint. KiCad's STEP models are several GB; attaching
  a model to a part is #628.
- **The rest of KiCad's libraries.** The starter set is what ships. Bring any other KiCad part in with Import parts,
  below.

## Sizes

KiCad's full libraries are far too big to ship in the app: thousands of footprint files, and 3D models that run to
gigabytes. The starter pack, `starter.json`, is 1.2 MB, about 100 KB compressed, for 228 parts: each symbol and
footprint is kept once and shared by the parts that use it.

The pack is one static file with a hashed name. The app fetches it the first time the Components panel opens; the
service worker then keeps it, so the panel works offline. It is not part of the app's first load.

## Changing the library

`packages/electronics/library/starter.manifest.json` lists the parts: a KiCad symbol (`Device:R`), the footprints it can
use, and the name, starting value, keywords and shelf people see. Then:

```
npm run library            # fetch the KiCad files it names (cached), rebuild starter.json and the list below
npm run library -- --check # the same, and fail if any part could not be built whole
npm run licences           # refresh the part library table in THIRD_PARTY_LICENSES.md
```

The KiCad files are fetched from gitlab.com/kicad/libraries at the release the manifest names and are not kept in this
repository. To move to a newer KiCad release, change `kicad` in the manifest and rebuild; the build says which names
changed.

A part with `"symbol": "module:<id>"` is one BetterCad draws, from `BREAKOUTS` in `modules.ts`.

## Your parts

Parts you make or import go in your own library (#629), shown in the Components panel on the **Your parts** shelf (or
any shelf you name) beside the starter library. It is a library pack like the starter one.

- **Where it lives.** In this browser (`localStorage`, `bettercad.electronics.library`), so it works offline and signed
  out. When you are signed in it is also kept in your account (`GET` and `PUT /api/parts-library`, one document per
  account) and merged on sign-in: the account's copy of a part wins, parts made before signing in go up, and a part
  deleted on one machine stays deleted on the others.
- **As a file.** Export saves the pack as `your-parts.bcparts.json`: plain JSON in the pack format
  (`LibraryPack` in `packages/electronics/src/library/pack.ts`), with every part's source and licence inside. Open
  library adds the parts of such a file; a part that is already there is not added twice.
- **Designs keep their own copy.** Deleting or changing a part in your library never changes a design that uses it.

Not built yet: sharing a library by link and publishing parts to the shared catalogue (#629), which wait on the
catalogue's review flow (#190).

### The part editor

New part, Edit and Edit a copy open the part editor (`web/src/electronics/PartTools.tsx`, logic in `partDraft.ts`):

- **Symbol** (#626): three ways. **A box from a pin list**: one pin a line as number, name, what it does and
  optionally a side. Paste it from a spreadsheet or a datasheet; plain words work ("power in", "io", "nc"). **Kept as
  it came**, for a copy of a library part: you can still rename its pins and change what they do. **Drawn by hand**
  (`SymbolEditor.tsx`, edits in `symbolEdit.ts`): lines, rectangles, circles, arcs and text on a 1.27 mm grid, and
  pins on the 2.54 mm grid with a number, a name, what they do, a side and a length. It starts from whatever the
  symbol was, so a box or a library drawing can be finished by hand. A symbol can have up to 26 units, each with its
  own drawing and pins (Copy unit A's drawing here saves drawing a gate four times). Undo and redo are the editor's
  own, and Esc puts down the shape, then the tool, before it closes the editor.
- **Footprint** (#627): pick a package family and type the sizes from the datasheet's land pattern, in mm. The families
  are two-pad chip, two rows (SOIC, SOP, TSSOP), four sides (QFP, QFN with a centre pad), DIP, pin header and ball grid
  (`packages/electronics/src/library/wizards.ts`). Each gets a fabrication outline, courtyard, silkscreen and a pin 1
  dot. The wizards are tested against KiCad's own footprints for 0603, SOIC-8, DIP-8, a 1 × 4 header and QFN-24.
- **3D body** (#628): sized from the footprint, or a box or cylinder of your own sizes, or none.
- **Checks**, as you type: every pin has a pad (this one stops a save), pads closer than 0.2 mm, no courtyard, nothing
  on the silkscreen to show pin 1, a hole that leaves no copper, pin lines that could not be read.

Not built yet: editing pads one at a time with per-pad mask and paste (#627), and attaching a STEP file or a BetterCad model as the body (#628, with the 3D
board).

### Importing KiCad files

Import parts (#623) takes `.kicad_sym` symbol libraries and `.kicad_mod` footprints, in KiCad 5 to 10 formats
(`importKicad` in `packages/electronics/src/kicad/import.ts`). You say where they are from and their licence, and both
are kept on every part.

- A symbol is paired with the footprint its own footprint field names, when that file is among those picked. Failing
  that, a footprint of that name from the starter library, then the one footprint its filters fit.
- A symbol with no footprint to be had comes in without one, and the card says so; nothing is forced to fit.
- A package is only kept if every pin has a pad. KiCad's stacked pins (`[1,2,11,36-38]`) become one pin mapped to all
  those pads.
- Power symbols are left out (BetterCad has its own), and so is a footprint no symbol uses.

Import parts also takes Eagle libraries (`.lbr`, #665): each device set is a component, with every device that has a
package as one of its packages. `docs/electronics.md`, "In from Eagle and Fusion Electronics", has the detail.

The KiCad reader is tested on files from SparkFun, Espressif and Digi-Key as well as KiCad's own
(`packages/electronics/src/kicad/testdata/external/README.md` has their credits).

## What is in it

<!-- generated: npm run library -->

### Passives

| Part | Starts as | Packages |
| --- | --- | --- |
| Resistor | 10 kΩ | 0603, 0402, 0805, 1206, R Axial DIN0207 L6.3mm D2.5mm |
| Capacitor | 100 nF | 0603, 0402, 0805, 1206, C Disc D5.0mm W2.5mm |
| Capacitor, polarised | 100 µF | CP Radial D5.0mm, CP Radial D6.3mm, CP Radial D8.0mm, CP Elec 6.3x5.4 |
| Inductor | 10 µH | 0603, 0402, 0805, 1206 |
| Ferrite bead | 600 Ω | 0603, 0805 |
| Potentiometer | 10 kΩ | Potentiometer Bourns 3386P Vertical, Potentiometer Alps RK09K Single Vertical |
| Thermistor, NTC | 10 kΩ | 0603, 0805 |
| Light dependent resistor | LDR | R LDR 5.1x4.3mm |
| Fuse | 1 A | 1206, 0805 |
| Resettable fuse | 500 mA | 1206, Fuse 1812 4532Metric |
| Crystal | 16 MHz | Crystal HC49-4H Vertical, Crystal SMD HC49-SD |
| Crystal, 4 pads | 12 MHz | Crystal SMD 3225-4Pin 3.2x2.5mm, Crystal SMD 5032-4Pin 5.0x3.2mm |

### Diodes and LEDs

| Part | Starts as | Packages |
| --- | --- | --- |
| LED | Red | 0603, 0805, 1206, LED D3.0mm, LED D5.0mm |
| LED, RGB, common anode | RGB | LED D5.0mm-4 RGB |
| Diode | Diode | D SOD-123, D SMA, D DO-35 SOD27, D DO-41 SOD81 |
| Schottky diode | Schottky | D SOD-123, D SMA, D DO-41 SOD81 |
| Zener diode | 5.1 V | D SOD-123, D DO-35 SOD27 |
| 1N4148 | 1N4148 | D DO-35 SOD27 |
| 1N4148W | 1N4148W | D SOD-123 |
| 1N4007 | 1N4007 | D DO-41 SOD81 |
| 1N5819 | 1N5819 | D DO-41 SOD81 |
| SS14 | SS14 | D SMA |
| SS34 | SS34 | D SMA |
| BAT54S | BAT54S | SOT-23 |
| WS2812B | WS2812B | LED WS2812B PLCC4 5.0x5.0mm |
| SK6812 | SK6812 | LED SK6812 PLCC4 5.0x5.0mm |
| SK6812MINI | SK6812MINI | LED SK6812MINI PLCC4 3.5x3.5mm |
| WS2812B-2020 | WS2812B-2020 | LED WS2812B-2020 PLCC4 2.0x2.0mm |
| APA102 | APA102 | LED RGB 5050-6 |

### Power symbols

| Part | Starts as | Packages |
| --- | --- | --- |
| GND | GND | None: a power symbol |
| 3V3 | +3V3 | None: a power symbol |
| 5V | +5V | None: a power symbol |
| VBUS | VBUS | None: a power symbol |
| VCC | VCC | None: a power symbol |
| VDD | VDD | None: a power symbol |
| 12V | +12V | None: a power symbol |
| 9V | +9V | None: a power symbol |
| Battery + | +BATT | None: a power symbol |
| GND, analogue | GNDA | None: a power symbol |
| Power flag | PWR_FLAG | None: a power symbol |

### Connectors

| Part | Starts as | Packages |
| --- | --- | --- |
| Pin header, 1 × 1 | 1×1 | PinHeader 1x01, PinSocket 1x01, PinHeader 1x01 |
| Pin header, 1 × 2 | 1×2 | PinHeader 1x02, PinSocket 1x02, PinHeader 1x02 |
| Pin header, 1 × 3 | 1×3 | PinHeader 1x03, PinSocket 1x03, PinHeader 1x03 |
| Pin header, 1 × 4 | 1×4 | PinHeader 1x04, PinSocket 1x04, PinHeader 1x04 |
| Pin header, 1 × 5 | 1×5 | PinHeader 1x05, PinSocket 1x05, PinHeader 1x05 |
| Pin header, 1 × 6 | 1×6 | PinHeader 1x06, PinSocket 1x06, PinHeader 1x06 |
| Pin header, 1 × 7 | 1×7 | PinHeader 1x07, PinSocket 1x07, PinHeader 1x07 |
| Pin header, 1 × 8 | 1×8 | PinHeader 1x08, PinSocket 1x08, PinHeader 1x08 |
| Pin header, 1 × 9 | 1×9 | PinHeader 1x09, PinSocket 1x09, PinHeader 1x09 |
| Pin header, 1 × 10 | 1×10 | PinHeader 1x10, PinSocket 1x10, PinHeader 1x10 |
| Pin header, 1 × 11 | 1×11 | PinHeader 1x11, PinSocket 1x11, PinHeader 1x11 |
| Pin header, 1 × 12 | 1×12 | PinHeader 1x12, PinSocket 1x12, PinHeader 1x12 |
| Pin header, 1 × 13 | 1×13 | PinHeader 1x13, PinSocket 1x13, PinHeader 1x13 |
| Pin header, 1 × 14 | 1×14 | PinHeader 1x14, PinSocket 1x14, PinHeader 1x14 |
| Pin header, 1 × 15 | 1×15 | PinHeader 1x15, PinSocket 1x15, PinHeader 1x15 |
| Pin header, 1 × 16 | 1×16 | PinHeader 1x16, PinSocket 1x16, PinHeader 1x16 |
| Pin header, 1 × 17 | 1×17 | PinHeader 1x17, PinSocket 1x17, PinHeader 1x17 |
| Pin header, 1 × 18 | 1×18 | PinHeader 1x18, PinSocket 1x18, PinHeader 1x18 |
| Pin header, 1 × 19 | 1×19 | PinHeader 1x19, PinSocket 1x19, PinHeader 1x19 |
| Pin header, 1 × 20 | 1×20 | PinHeader 1x20, PinSocket 1x20, PinHeader 1x20 |
| Pin header, 2 × 2 | 2×2 | PinHeader 2x02, PinSocket 2x02 |
| Pin header, 2 × 3 | 2×3 | PinHeader 2x03, PinSocket 2x03 |
| Pin header, 2 × 4 | 2×4 | PinHeader 2x04, PinSocket 2x04 |
| Pin header, 2 × 5 | 2×5 | PinHeader 2x05, PinSocket 2x05 |
| Pin header, 2 × 6 | 2×6 | PinHeader 2x06, PinSocket 2x06 |
| Pin header, 2 × 7 | 2×7 | PinHeader 2x07, PinSocket 2x07 |
| Pin header, 2 × 8 | 2×8 | PinHeader 2x08, PinSocket 2x08 |
| Pin header, 2 × 9 | 2×9 | PinHeader 2x09, PinSocket 2x09 |
| Pin header, 2 × 10 | 2×10 | PinHeader 2x10, PinSocket 2x10 |
| Pin header, 2 × 11 | 2×11 | PinHeader 2x11, PinSocket 2x11 |
| Pin header, 2 × 12 | 2×12 | PinHeader 2x12, PinSocket 2x12 |
| Pin header, 2 × 13 | 2×13 | PinHeader 2x13, PinSocket 2x13 |
| Pin header, 2 × 14 | 2×14 | PinHeader 2x14, PinSocket 2x14 |
| Pin header, 2 × 15 | 2×15 | PinHeader 2x15, PinSocket 2x15 |
| Pin header, 2 × 16 | 2×16 | PinHeader 2x16, PinSocket 2x16 |
| Pin header, 2 × 17 | 2×17 | PinHeader 2x17, PinSocket 2x17 |
| Pin header, 2 × 18 | 2×18 | PinHeader 2x18, PinSocket 2x18 |
| Pin header, 2 × 19 | 2×19 | PinHeader 2x19, PinSocket 2x19 |
| Pin header, 2 × 20 | 2×20 | PinHeader 2x20, PinSocket 2x20 |
| JST PH, 2 pins | JST PH 2 | JST PH B2B-PH-K 1x02, JST PH S2B-PH-K 1x02 |
| JST PH, 3 pins | JST PH 3 | JST PH B3B-PH-K 1x03, JST PH S3B-PH-K 1x03 |
| JST PH, 4 pins | JST PH 4 | JST PH B4B-PH-K 1x04, JST PH S4B-PH-K 1x04 |
| JST PH, 5 pins | JST PH 5 | JST PH B5B-PH-K 1x05, JST PH S5B-PH-K 1x05 |
| JST PH, 6 pins | JST PH 6 | JST PH B6B-PH-K 1x06, JST PH S6B-PH-K 1x06 |
| JST PH, 7 pins | JST PH 7 | JST PH B7B-PH-K 1x07, JST PH S7B-PH-K 1x07 |
| JST PH, 8 pins | JST PH 8 | JST PH B8B-PH-K 1x08, JST PH S8B-PH-K 1x08 |
| JST XH, 2 pins | JST XH 2 | JST XH B2B-XH-A 1x02, JST XH S2B-XH-A 1x02 |
| JST XH, 3 pins | JST XH 3 | JST XH B3B-XH-A 1x03, JST XH S3B-XH-A 1x03 |
| JST XH, 4 pins | JST XH 4 | JST XH B4B-XH-A 1x04, JST XH S4B-XH-A 1x04 |
| JST XH, 5 pins | JST XH 5 | JST XH B5B-XH-A 1x05, JST XH S5B-XH-A 1x05 |
| JST XH, 6 pins | JST XH 6 | JST XH B6B-XH-A 1x06, JST XH S6B-XH-A 1x06 |
| JST XH, 7 pins | JST XH 7 | JST XH B7B-XH-A 1x07, JST XH S7B-XH-A 1x07 |
| JST XH, 8 pins | JST XH 8 | JST XH B8B-XH-A 1x08, JST XH S8B-XH-A 1x08 |
| JST SH, 4 pins (Qwiic, STEMMA QT) | Qwiic | JST SH SM04B-SRSS-TB 1x04-1MP, JST SH BM04B-SRSS-TB 1x04-1MP |
| JST SH, 3 pins | JST SH 3 | JST SH SM03B-SRSS-TB 1x03-1MP |
| Screw terminal, 2 way | 2 way | TerminalBlock bornier-2, TerminalBlock Phoenix MKDS-1,5-2-5.08 1x02 |
| Screw terminal, 3 way | 3 way | TerminalBlock bornier-3, TerminalBlock Phoenix MKDS-1,5-3-5.08 1x03 |
| Screw terminal, 4 way | 4 way | TerminalBlock bornier-4, TerminalBlock Phoenix MKDS-1,5-4-5.08 1x04 |
| USB-C socket, USB 2.0 | USB-C | USB C Receptacle HRO TYPE-C-31-M-12, USB C Receptacle GCT USB4105-xx-A 16P TopMnt Horizontal |
| Micro USB socket | Micro USB | USB Micro-B Molex-105017-0001, USB Micro-B Wuerth 629105150521 |
| Barrel jack | DC jack | BarrelJack Horizontal, BarrelJack CUI PJ-102AH Horizontal |
| microSD card socket | microSD | microSD HC Hirose DM3AT-SF-PEJM5, microSD HC Molex 104031-0811 |
| Raspberry Pi 40-pin header | Pi GPIO | PinSocket 2x20, PinHeader 2x20 |
| SWD debug header, 10 pins | Conn_ARM_JTAG_SWD_10 | PinHeader 2x05, PinHeader 2x05 |
| Servo header | Servo | PinHeader 1x03 |
| DC motor | Motor | PinHeader 1x02, TerminalBlock bornier-2, JST PH B2B-PH-K 1x02 |
| Stepper motor, bipolar | Stepper | JST XH B4B-XH-A 1x04, PinHeader 1x04 |
| Coin cell holder, CR2032 | CR2032 | BatteryHolder Keystone 3034 1x20mm, BatteryHolder Keystone 103 1x20mm |
| Battery connector | Battery | JST PH B2B-PH-K 1x02, JST XH B2B-XH-A 1x02, TerminalBlock bornier-2 |

### Switches and sound

| Part | Starts as | Packages |
| --- | --- | --- |
| Push button | Button | SW PUSH 6mm, SW SPST TL3342 |
| Slide switch | Switch | SW SPDT PCM12, SW Slide-03 Wuerth-WS-SLTV 10x2.5x6.4 |
| DIP switch, 4 way | DIP 4 | SW DIP SPSTx04 Slide 9.78x12.34mm W7.62mm |
| Buzzer | Buzzer | Buzzer 12x9.5RM7.6, MagneticBuzzer ProSignal ABT-410-RC |
| Speaker | Speaker | PinHeader 1x02, JST PH B2B-PH-K 1x02 |
| Solder jumper, open | SolderJumper_2_Open | SolderJumper-2, SolderJumper-2 |
| Solder jumper, bridged | SolderJumper_2_Bridged | SolderJumper-2 |
| Solder jumper, 3 pads | SolderJumper_3_Open | SolderJumper-3 |
| Jumper, 2 pins | Jumper_2_Open | PinHeader 1x02 |
| Jumper, 3 pins | Jumper_3_Open | PinHeader 1x03 |
| SANYOU SRD Form C | SANYOU_SRD_Form_C | Relay SPDT SANYOU SRD Series Form C |
| G5LE-1 | G5LE-1 | Relay SPDT Omron-G5LE-1 |

### Power

| Part | Starts as | Packages |
| --- | --- | --- |
| AMS1117-3.3 | AMS1117-3.3 | SOT-223-3 |
| AMS1117-5.0 | AMS1117-5.0 | SOT-223-3 |
| AP2112K-3.3 | AP2112K-3.3 | SOT-23-5 |
| ME6211C33M5 | ME6211C33M5 | SOT-23-5 |
| LM7805 TO220 | LM7805_TO220 | TO-220-3 |
| LD1117S33TR SOT223 | LD1117S33TR_SOT223 | SOT-223-3 |
| MT3608 | MT3608 | SOT-23-6 |
| LM2596S-5 | LM2596S-5 | TO-263-5 |
| AP63203WU | AP63203WU | TSOT-23-6 |
| TPS563200 | TPS563200 | SOT-23-6 |
| TP4056-42-ESOP8 | TP4056-42-ESOP8 | SOIC-8 |
| MCP73831-2-OT | MCP73831-2-OT | SOT-23-5 |
| DW01A | DW01A | SOT-23-6 |

### Transistors

| Part | Starts as | Packages |
| --- | --- | --- |
| BSS138 | BSS138 | SOT-23 |
| 2N7002 | 2N7002 | SOT-23 |
| AO3400A | AO3400A | SOT-23 |
| AO3401A | AO3401A | SOT-23 |
| IRLML6402 | IRLML6402 | SOT-23 |
| IRLZ44N | IRLZ44N | TO-220-3 |
| IRF540N | IRF540N | TO-220-3 |
| 2N3904 | 2N3904 | TO-92 |
| 2N3906 | 2N3906 | TO-92 |
| BC547 | BC547 | TO-92 |
| BC557 | BC557 | TO-92 |
| S8050 | S8050 | TO-92 |
| SS8050 | SS8050 | SOT-23 |
| MMBT3904 | MMBT3904 | SOT-23 |
| MMBT3906 | MMBT3906 | SOT-23 |
| MMBT2222A | MMBT2222A | SOT-23 |
| PN2222A | PN2222A | TO-92 |
| BC817 | BC817 | SOT-23 |
| TIP120 | TIP120 | TO-220-3 |
| PC817 | PC817 | DIP-4 |
| 4N35 | 4N35 | DIP-6 |

### Motor drivers

| Part | Starts as | Packages |
| --- | --- | --- |
| DRV8833 motor driver (TSSOP) | DRV8833PW | TSSOP-16 |
| DRV8833 motor driver (HTSSOP) | DRV8833PWP | HTSSOP-16 |
| TB6612FNG motor driver | TB6612FNG | SSOP-24 |
| L293D motor driver | L293D | DIP-16 |
| L298N motor driver | L298N | TO-220-1 |
| DRV8871 motor driver | DRV8871DDA | Texas HTSOP-8-1EP 3.9x4.9mm |
| A4988 stepper driver carrier | Pololu_Breakout_A4988 | Pololu Breakout-16 15.2x20.3mm |
| DRV8825 stepper driver carrier | Pololu_Breakout_DRV8825 | Pololu Breakout-16 15.2x20.3mm |

### Microcontrollers and modules

| Part | Starts as | Packages |
| --- | --- | --- |
| Raspberry Pi Pico | Pico | RaspberryPi Pico Common Unspecified, RaspberryPi Pico SMD, RaspberryPi Pico Common THT, RaspberryPi Pico SMD HandSolder |
| Raspberry Pi Pico W | Pico W | RaspberryPi Pico Common Unspecified, RaspberryPi Pico SMD, RaspberryPi Pico Common THT, RaspberryPi Pico SMD HandSolder |
| Raspberry Pi Pico 2 | Pico 2 | RaspberryPi Pico Common Unspecified, RaspberryPi Pico SMD, RaspberryPi Pico Common THT, RaspberryPi Pico SMD HandSolder |
| Raspberry Pi Pico 2 W | Pico 2 W | RaspberryPi Pico Common Unspecified, RaspberryPi Pico SMD, RaspberryPi Pico Common THT, RaspberryPi Pico SMD HandSolder |
| RP2040 | RP2040 | QFN-56 |
| Arduino Nano | Arduino_Nano_v3.x | Arduino Nano |
| Arduino Uno R3 (shield) | Arduino_UNO_R3 | Arduino UNO R3 |
| Arduino Nano ESP32 | Arduino_Nano_ESP32 | Arduino Nano |
| Arduino Nano RP2040 Connect | Arduino_Nano_RP2040_Connect | Arduino Nano |
| Arduino Nano Every | Arduino_Nano_Every | Arduino Nano |
| Adafruit Feather | Adafruit_Feather_Generic | Adafruit Feather |
| ESP32-WROOM-32E | ESP32-WROOM-32E | ESP32-WROOM-32D |
| ESP32-WROOM-32 | ESP32-WROOM-32 | ESP32-WROOM-32 |
| ESP32-C3-WROOM-02 | ESP32-C3-WROOM-02 | ESP32-C3-WROOM-02 |
| ESP32-S3-WROOM-1 | ESP32-S3-WROOM-1 | ESP32-S3-WROOM-1 |
| ESP32-S3-MINI-1 | ESP32-S3-MINI-1 | ESP32-S2-MINI-1 |
| ESP32-C6-MINI-1 | ESP32-C6-MINI-1 | ESP32-C6-MINI-1 |
| ESP32-C3-DevKitM-1 | ESP32-C3-DevKitM-1 | ESP32-C3-DevKitM-1 |
| ESP-12F | ESP-12F | ESP-12E |

### Chips

| Part | Starts as | Packages |
| --- | --- | --- |
| CH340C | CH340C | SOIC-16 |
| CH340G | CH340G | SOIC-16 |
| CH340E | CH340E | MSOP-10 |
| CP2102N-Axx-xQFN24 | CP2102N-Axx-xQFN24 | QFN-24 |
| FT232RL | FT232RL | SSOP-28 |
| CH9102F | CH9102F | QFN-24 |
| NE555 timer | NE555P | DIP-8, SOIC-8 |
| LM358 | LM358 | SOIC-8, DIP-8 |
| LM324 | LM324 | SOIC-14, DIP-14 |
| MCP6002 | MCP6002-xSN | SOIC-8, DIP-8 |
| 74HC595 | 74HC595 | SOIC-16, DIP-16 |
| 74HC165 | 74HC165 | SOIC-16, DIP-16 |
| 74HC138 | 74HC138 | SOIC-16, DIP-16 |
| 74HC00 | 74HC00 | SOIC-14, DIP-14 |
| 74HC04 | 74HC04 | SOIC-14, DIP-14 |
| 74HC14 | 74HC14 | SOIC-14, DIP-14 |
| 74AHCT125 | 74AHCT125 | SOIC-14, DIP-14 |
| 74HC245 | 74HC245 | SOIC-20W, DIP-20 |
| TXS0108EPW | TXS0108EPW | TSSOP-20 |
| TXB0104PW | TXB0104PW | TSSOP-14 |
| SN74LVC1T45DBV | SN74LVC1T45DBV | SOT-23-6 |
| 24LC256 | 24LC256 | SOIC-8, DIP-8 |
| MAX3232 | MAX3232 | SOIC-16, DIP-16 |
| SP3485EN | SP3485EN | SOIC-8 |

### Sensors and displays

| Part | Starts as | Packages |
| --- | --- | --- |
| MPU-6050 | MPU-6050 | InvenSense QFN-24 4x4mm |
| BNO055 | BNO055 | LGA-28 |
| LSM6DS3 | LSM6DS3 | LGA-14 |
| ICM-20948 | ICM-20948 | InvenSense QFN-24 3x3mm |
| BME280 | BME280 | Bosch LGA-8 2.5x2.5mm |
| BME680 | BME680 | Bosch LGA-8 3x3mm |
| DHT11 | DHT11 | Aosong DHT11 5.5x12.0 |
| MAX30102 | MAX30102 | Maxim OLGA-14 3.3x5.6mm |
| DS18B20 | DS18B20 | TO-92 |
| LM35-LP | LM35-LP | TO-92 |
| VL53L0CXV0DH1 | VL53L0CXV0DH1 | ST VL53L1x |
| VL53L1CXV0FY1 | VL53L1CXV0FY1 | ST VL53L1x |
| WC1602A | WC1602A | WC1602A |
| RC1602A | RC1602A | RC1602A |
| HC-SR04 ultrasonic sensor | HC-SR04 | HC-SR04 ultrasonic sensor (1×4 pins) |
| SSD1306 OLED display, 0.96 in, I2C | SSD1306 | SSD1306 OLED display, 0.96 in, I2C (1×4 pins) |
| MPU-6050 module (GY-521) | GY-521 | MPU-6050 module (GY-521) (1×8 pins) |
| VL53L0X distance sensor module | VL53L0X | VL53L0X distance sensor module (1×6 pins) |

### Mechanical

| Part | Starts as | Packages |
| --- | --- | --- |
| Mounting hole | M3 | MountingHole 3.2mm M3, MountingHole 2.7mm M2.5, MountingHole 2.2mm M2, MountingHole 4.3mm M4 |
| Mounting hole, plated | M3 | MountingHole 3.2mm M3 Pad Via, MountingHole 2.7mm M2.5 Pad Via, MountingHole 3.2mm M3 Pad |
| Fiducial | Fiducial | Fiducial 1mm Mask2mm, Fiducial 0.5mm Mask1mm |
| Test point | TP | TestPoint Pad D1.5mm, TestPoint THTPad D2.0mm Drill1.0mm, TestPoint Loop D2.50mm Drill1.0mm |
<!-- end generated -->
