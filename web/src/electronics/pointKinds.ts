import type { PointKind } from "@bettercad/electronics";

/** What a connection point is for, in words. */
export const KIND_TEXT: Record<PointKind, string> = {
  "power-in": "Power in",
  "power-out": "Power out",
  ground: "Ground",
  "i2c-sda": "I2C data",
  "i2c-scl": "I2C clock",
  "signal-in": "Signal in",
  "signal-out": "Signal out",
  load: "To a motor or load",
  plain: "Connection",
};
