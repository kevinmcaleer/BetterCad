import { describe, expect, it } from "vitest";
import { keyboardInset, trackKeyboard } from "./keyboardInset";

describe("keyboard inset", () => {
  it("is what the keyboard covers at the bottom, and nothing without one", () => {
    expect(keyboardInset({ innerHeight: 1000, visualViewport: { height: 1000, offsetTop: 0 } })).toBe(0);
    expect(keyboardInset({ innerHeight: 1000, visualViewport: { height: 600, offsetTop: 0 } })).toBe(400);
    // Safari pans the page up to show the field: the keys cover less of the layout.
    expect(keyboardInset({ innerHeight: 1000, visualViewport: { height: 600, offsetTop: 100 } })).toBe(300);
    // A toolbar sliding away is not a keyboard.
    expect(keyboardInset({ innerHeight: 1000, visualViewport: { height: 960, offsetTop: 0 } })).toBe(0);
    expect(keyboardInset({ innerHeight: 1000 })).toBe(0);
  });

  it("publishes --bc-keyboard as the visual viewport changes", () => {
    const listeners: Record<string, () => void> = {};
    const vv = { height: 800, offsetTop: 0, addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: () => {} };
    const w = { innerHeight: 800, visualViewport: vv } as unknown as Window;
    const el = document.createElement("div");
    const stop = trackKeyboard(el, w);
    expect(el.style.getPropertyValue("--bc-keyboard")).toBe("0px");
    vv.height = 450;
    listeners.resize!();
    expect(el.style.getPropertyValue("--bc-keyboard")).toBe("350px");
    stop();
  });
});
