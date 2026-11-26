/**
 * The starter blocks' versions by id (#773), apart from the blocks themselves so the schematic can show an Update
 * badge without loading the whole shelf. A test keeps it in step with `STARTER_BLOCKS`.
 */
export const STARTER_VERSIONS: Readonly<Record<string, number>> = {
  "reg-3v3-linear": 1,
  "reg-3v3-buck": 1,
  "boost-5v": 1,
  "lipo-charger": 1,
  "lipo-protect": 1,
  "usb-c-power": 1,
  "reverse-protect": 1,
  drv8833: 1,
  tb6612fng: 1,
  "stepper-carrier": 1,
  "servo-headers": 1,
  "low-side-switch": 1,
  qwiic: 1,
  "i2c-level-shifter": 1,
  "level-shifter-8": 1,
  "neopixel-start": 1,
  "battery-monitor": 1,
  "button-led": 1,
  "uart-header": 1,
};
