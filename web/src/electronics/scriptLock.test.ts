import { describe, expect, it } from "vitest";
import { LOCKED, lockDown } from "./scriptLock";

describe("the script sandbox's lock-down (#764)", () => {
  it("takes the network, storage and messages off a scope and everything it inherits from", () => {
    // A worker's scope keeps fetch and postMessage on its prototypes, as browsers do.
    const proto = { fetch: () => 1, postMessage: () => 2, indexedDB: {} };
    const scope = Object.create(Object.create(proto)) as Record<string, unknown>;
    scope.WebSocket = class {};
    const gone = lockDown(scope);
    expect(gone.sort()).toEqual(["WebSocket", "fetch", "indexedDB", "postMessage"]);
    for (const name of LOCKED) expect(scope[name]).toBeUndefined();
    expect("fetch" in proto).toBe(false);
    // And they stay gone.
    expect(() => {
      "use strict";
      scope.fetch = () => 3;
    }).toThrow();
    expect(scope.fetch).toBeUndefined();
  });
});
