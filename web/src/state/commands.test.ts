import { comboOf, createRegistry, formatCombo, fuzzyScore, search, type Command, type CommandContext } from "./commands";

const ctx: CommandContext = { hasSelection: false, inSketch: false, toolActive: false, canUndo: true, canRedo: false, dialogOpen: false };
const ev = (key: string, mods: Partial<KeyboardEvent> = {}, target?: HTMLElement) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: target ?? document.body, preventDefault() {}, ...mods }) as KeyboardEvent;

function setup(extra: Partial<CommandContext> = {}) {
  const ran: string[] = [];
  const reg = createRegistry(() => ({ ...ctx, ...extra }));
  const cmd = (id: string, keys: string[], more: Partial<Command> = {}): Command => ({ id, label: id, group: "Edit", keys, run: () => ran.push(id), ...more });
  reg.register([
    cmd("undo", ["mod+z"], { when: (c) => c.canUndo }),
    cmd("redo", ["shift+mod+z", "mod+y"], { when: (c) => c.canRedo }),
    cmd("move", ["m"]),
    cmd("delete", ["delete"], { when: (c) => c.hasSelection }),
    cmd("help", ["?"], { label: "Keyboard shortcuts", keywords: "keys" }),
  ]);
  return { reg, ran, cmd };
}

describe("key combos", () => {
  it("normalises and formats", () => {
    expect(comboOf(ev("Z", { ctrlKey: true, shiftKey: true }))).toBe("shift+mod+z");
    expect(comboOf(ev("?", { shiftKey: true }))).toBe("?");
    expect(formatCombo("shift+mod+z", false)).toBe("Ctrl+Shift+Z");
    expect(formatCombo("shift+mod+z", true)).toBe("⇧⌘Z");
    expect(formatCombo("escape", false)).toBe("Esc");
  });
});

describe("registry", () => {
  it("dispatches by key and respects when", () => {
    const { reg, ran } = setup();
    expect(reg.dispatch(ev("m"))).toBe(true);
    expect(reg.dispatch(ev("z", { ctrlKey: true }))).toBe(true);
    expect(reg.dispatch(ev("y", { metaKey: true }))).toBe(false);
    expect(reg.dispatch(ev("Delete"))).toBe(false);
    expect(ran).toEqual(["move", "undo"]);
  });
  it("ignores plain keys while typing but lets undo through", () => {
    const { reg, ran } = setup();
    const input = document.createElement("input");
    expect(reg.dispatch(ev("m", {}, input))).toBe(false);
    expect(reg.dispatch(ev("c", { ctrlKey: true }, input))).toBe(false);
    expect(reg.dispatch(ev("z", { ctrlKey: true }, input))).toBe(true);
    expect(ran).toEqual(["undo"]);
  });
  it("throws on a duplicate shortcut in development", () => {
    const { reg, cmd } = setup();
    expect(() => reg.register(cmd("other", ["m"]))).toThrow(/already used by move/);
  });
  it("unregisters and notifies", () => {
    const { reg, cmd } = setup();
    const seen = vi.fn();
    reg.subscribe(seen);
    const off = reg.register(cmd("extra", ["x"]));
    expect(reg.get("extra")).toBeTruthy();
    off();
    expect(reg.get("extra")).toBeUndefined();
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it("runs by id only when enabled", () => {
    const { reg, ran } = setup({ hasSelection: true });
    expect(reg.run("delete")).toBe(true);
    expect(reg.run("redo")).toBe(false);
    expect(ran).toEqual(["delete"]);
  });
});

describe("palette search", () => {
  it("fuzzy matches letters in order and ranks word starts", () => {
    expect(fuzzyScore("Keyboard shortcuts", "ksc")).toBeGreaterThan(0);
    expect(fuzzyScore("Undo", "xyz")).toBe(-1);
    expect(fuzzyScore("Theme: Holoroom", "holo")).toBeGreaterThan(fuzzyScore("Theme: Holoroom", "hdk"));
  });
  it("orders results best first and searches keywords", () => {
    const { reg } = setup();
    expect(search(reg.list(), "keys").map((c) => c.id)).toEqual(["help"]);
    expect(search(reg.list(), "mv")[0]!.id).toBe("move");
    expect(search(reg.list(), "").length).toBe(5);
  });
});
