import { backOut, escapeDepth, pushEscape, ESC } from "./escape";

describe("layered Escape", () => {
  const press = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));

  it("backs out one layer per press, highest first, then most recent first", () => {
    const order: string[] = [];
    const removers: (() => void)[] = [];
    const layer = (name: string, priority: number) => {
      const remove = pushEscape(() => {
        order.push(name);
        remove();
      }, priority);
      removers.push(remove);
    };
    layer("selection", ESC.selection);
    layer("tool", ESC.tool);
    layer("menu", ESC.overlay);
    layer("submenu", ESC.overlay);
    expect(escapeDepth()).toBe(4);
    press();
    press();
    press();
    press();
    expect(order).toEqual(["submenu", "menu", "tool", "selection"]);
    expect(escapeDepth()).toBe(0);
    press();
    expect(order).toHaveLength(4);
  });
  it("leaves an Escape alone when something already handled it", () => {
    const run = vi.fn();
    const remove = pushEscape(run);
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    e.preventDefault();
    window.dispatchEvent(e);
    expect(run).not.toHaveBeenCalled();
    expect(backOut()).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    remove();
    expect(backOut()).toBe(false);
  });
});
