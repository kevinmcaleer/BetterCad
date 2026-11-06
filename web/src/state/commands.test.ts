import { comboOf, formatCombo, match, search, type Command } from "./commands";

const ev = (key: string, mods: Partial<KeyboardEvent> = {}, target?: HTMLElement) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: target ?? document.body, ...mods }) as KeyboardEvent;

describe("commands", () => {
  const run = vi.fn();
  const cmds: Command[] = [
    { id: "undo", label: "Undo", group: "Edit", keys: ["mod+z"], run },
    { id: "redo", label: "Redo", group: "Edit", keys: ["shift+mod+z", "mod+y"], run },
    { id: "move", label: "Move", group: "Tools", keys: ["m"], run },
    { id: "help", label: "Keyboard shortcuts", group: "Help", keys: ["?"], run, keywords: "keys" },
    { id: "off", label: "Disabled", group: "Edit", keys: ["d"], run, enabled: false },
  ];
  it("normalises combos", () => {
    expect(comboOf(ev("Z", { ctrlKey: true, shiftKey: true }))).toBe("shift+mod+z");
    expect(comboOf(ev("?", { shiftKey: true }))).toBe("?");
    expect(comboOf(ev("Escape"))).toBe("escape");
  });
  it("formats combos for each platform", () => {
    expect(formatCombo("shift+mod+z", false)).toBe("Ctrl+Shift+Z");
    expect(formatCombo("shift+mod+z", true)).toBe("⇧⌘Z");
    expect(formatCombo("m", false)).toBe("M");
    expect(formatCombo("escape", false)).toBe("Esc");
  });
  it("matches keys, skipping plain keys while typing and disabled commands", () => {
    expect(match(cmds, ev("m"))?.id).toBe("move");
    expect(match(cmds, ev("y", { metaKey: true }))?.id).toBe("redo");
    const input = document.createElement("input");
    expect(match(cmds, ev("m", {}, input))).toBeUndefined();
    expect(match(cmds, ev("z", { ctrlKey: true }, input))).toBeUndefined();
    expect(match(cmds, ev("d"))).toBeUndefined();
  });
  it("searches labels, groups and keywords", () => {
    expect(search(cmds, "keys").map((c) => c.id)).toEqual(["help"]);
    expect(search(cmds, "edit re").map((c) => c.id)).toEqual(["redo"]);
    expect(search(cmds, "").length).toBe(cmds.length);
  });
});
