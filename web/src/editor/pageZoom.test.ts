// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardPageZoom } from "./pageZoom";

describe("guardPageZoom", () => {
  let off: () => void;
  let view: HTMLCanvasElement;
  let panel: HTMLDivElement;
  let zooms: WheelEvent[];

  beforeEach(() => {
    view = document.createElement("canvas");
    view.className = "bc-canvas bc-view-canvas";
    panel = document.createElement("div");
    document.body.append(view, panel);
    zooms = [];
    view.addEventListener("wheel", (e) => {
      if (e.ctrlKey) e.preventDefault();
      zooms.push(e);
    });
    document.elementsFromPoint = vi.fn(() => [panel, view, document.body]);
    off = guardPageZoom(window);
  });
  afterEach(() => {
    off();
    view.remove();
    panel.remove();
  });

  const pinch = (target: Element, deltaY: number, ctrlKey = true) => {
    const e = new WheelEvent("wheel", { deltaY, ctrlKey, clientX: 10, clientY: 20, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };

  it("stops a pinch over a panel zooming the page and zooms the view under it", () => {
    const e = pinch(panel, -4);
    expect(e.defaultPrevented).toBe(true);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toMatchObject({ ctrlKey: true, deltaY: -4, clientX: 10, clientY: 20 });
  });

  it("leaves a pinch on the view to the view", () => {
    pinch(view, 3);
    expect(zooms).toHaveLength(1);
  });

  it("lets plain wheels scroll panels", () => {
    const e = pinch(panel, 30, false);
    expect(e.defaultPrevented).toBe(false);
    expect(zooms).toHaveLength(0);
  });

  it("still blocks page zoom with no view under the pointer, or under a modal dialog", () => {
    document.elementsFromPoint = vi.fn(() => [panel, document.body]);
    expect(pinch(panel, 2).defaultPrevented).toBe(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    dialog.append(panel);
    document.body.append(dialog);
    document.elementsFromPoint = vi.fn(() => [panel, view]);
    expect(pinch(panel, 2).defaultPrevented).toBe(true);
    expect(zooms).toHaveLength(0);
    dialog.remove();
  });

  it("turns a Safari trackpad pinch into view zoom", () => {
    const gesture = (type: string, scale: number) => {
      const e = Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 10, clientY: 20 });
      window.dispatchEvent(e);
      return e;
    };
    expect(gesture("gesturestart", 1).defaultPrevented).toBe(true);
    expect(gesture("gesturechange", 2).defaultPrevented).toBe(true);
    expect(zooms).toHaveLength(1);
    // Fingers apart zoom in: a negative delta, as a Chrome pinch-out sends.
    expect(zooms[0]!.deltaY).toBeCloseTo(Math.log(0.5) * 100);
  });

  it("only blocks gestures that come with touches, which the view reads itself", () => {
    window.dispatchEvent(Object.assign(new Event("touchstart"), { touches: { length: 2 } }));
    const e = Object.assign(new Event("gesturechange", { cancelable: true }), { scale: 2, clientX: 10, clientY: 20 });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(zooms).toHaveLength(0);
    window.dispatchEvent(Object.assign(new Event("touchend"), { touches: { length: 0 } }));
  });
});
