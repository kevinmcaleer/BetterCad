import { createStore } from "./store";

describe("store", () => {
  it("edits, undoes and redoes, notifying subscribers", () => {
    const s = createStore(0);
    const seen = vi.fn();
    s.subscribe(seen);
    s.edit((n) => n + 1, "Add one");
    s.edit((n) => n + 1, "Add one");
    expect(s.get()).toBe(2);
    expect(s.undoLabel()).toBe("Add one");
    s.undo();
    expect(s.get()).toBe(1);
    expect(s.redoLabel()).toBe("Add one");
    s.redo();
    expect(s.get()).toBe(2);
    expect(seen).toHaveBeenCalledTimes(4);
  });
  it("merges a scrub into one step", () => {
    const s = createStore(0);
    for (let i = 1; i <= 5; i++) s.edit(() => i, "Width", "w");
    s.seal();
    s.undo();
    expect(s.get()).toBe(0);
  });
});
