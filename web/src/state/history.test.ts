import { createHistory, push, undo, redo, seal, canUndo, canRedo } from "./history";

describe("history", () => {
  it("undoes and redoes with labels", () => {
    let h = createHistory(0);
    h = push(h, 1, "One");
    h = push(h, 2, "Two");
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(h.future[0]!.label).toBe("Two");
    h = redo(h);
    expect(h.present).toBe(2);
    expect(h.label).toBe("Two");
  });
  it("drops the redo branch on a new edit", () => {
    let h = push(push(createHistory("a"), "b", "B"), "c", "C");
    h = undo(h);
    h = push(h, "d", "D");
    expect(canRedo(h)).toBe(false);
    expect(h.past.map((p) => p.state)).toEqual(["a", "b"]);
  });
  it("coalesces edits with the same key until sealed", () => {
    let h = createHistory(0);
    h = push(h, 1, "Width", "w");
    h = push(h, 2, "Width", "w");
    h = push(h, 3, "Width", "w");
    expect(h.past.length).toBe(1);
    h = seal(h);
    h = push(h, 4, "Width", "w");
    expect(h.past.length).toBe(2);
    expect(undo(undo(h)).present).toBe(0);
  });
  it("is a no-op at the ends", () => {
    const h = createHistory(1);
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
