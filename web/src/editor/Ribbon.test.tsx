import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRegistry, type Command, type CommandContext } from "../state/commands";
import { RibbonTools } from "./Ribbon";

const ctx: CommandContext = { hasSelection: false, inSketch: false, toolActive: false, canUndo: false, canRedo: false, dialogOpen: false };

function setup(over: Partial<Parameters<typeof RibbonTools>[0]> = {}) {
  localStorage.clear();
  const ran: string[] = [];
  const registry = createRegistry(() => ctx);
  const tool = (id: string, label: string, keys?: string[], more: Partial<Command> = {}): Command => ({
    id,
    label,
    group: "Tools",
    icon: "extrude",
    keys,
    run: () => ran.push(id),
    ...more,
  });
  registry.register([
    tool("tool.select", "Select", ["v"]),
    tool("tool.move", "Move", ["m"]),
    tool("tool.turn", "Turn", ["r"]),
    tool("tool.sketch", "Sketch", ["k"]),
    tool("tool.extrude", "Extrude", ["e"]),
    tool("tool.revolve", "Revolve"),
    tool("tool.sweep", "Sweep"),
    tool("tool.pushpull", "Push/pull", ["p"]),
    tool("tool.fillet", "Fillet", ["g"]),
    tool("tool.shell", "Shell", ["s"]),
    tool("tool.combine", "Combine", ["c"], { when: () => false }),
    tool("tool.split", "Split body"),
    tool("tool.pattern", "Pattern"),
    tool("tool.mirror", "Mirror"),
  ]);
  render(<RibbonTools tab="model" registry={registry} tool="extrude" panel="parts" {...over} />);
  return { ran };
}

describe("RibbonTools", () => {
  it("shows each group's pinned tools big, named and pressed when armed", () => {
    setup();
    const create = screen.getByRole("group", { name: "Create" });
    expect(within(create).getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "true");
    expect(within(create).getByRole("button", { name: "Sketch" })).toHaveAttribute("data-tip", "Sketch (K)");
    // Sweep is in the group, but not pinned.
    expect(within(create).queryByRole("button", { name: "Sweep" })).toBeNull();
    // Tools whose command is not there (Loft) are left out.
    expect(within(create).queryByRole("button", { name: "Loft" })).toBeNull();
  });

  it("runs a tool's command, and greys one that can't run now", () => {
    const { ran } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Shell" }));
    expect(ran).toEqual(["tool.shell"]);
    expect(screen.getByRole("button", { name: "Combine" })).toBeDisabled();
  });

  it("lists every tool in a group from its name, with sections and shortcuts", () => {
    const { ran } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Modify" }));
    const menu = screen.getByRole("menu", { name: "Modify tools" });
    expect(within(menu).getByText("Bodies")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Split body/ }));
    expect(ran).toEqual(["tool.split"]);
  });

  it("pins a tool to the ribbon from the drop-down, and keeps the pins", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const pin = screen.getByRole("menuitemcheckbox", { name: "Show Sweep on the ribbon" });
    expect(pin).toHaveAttribute("aria-checked", "false");
    fireEvent.click(pin);
    expect(within(screen.getByRole("group", { name: "Create" })).getByRole("button", { name: "Sweep" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("bettercad.ribbonPins")!)["model.create"]).toContain("tool.sweep");
  });

  it("presses Mirror, not Pattern, while mirroring", () => {
    setup({ tool: "pattern", mirrorOn: true });
    expect(screen.getByRole("button", { name: "Mirror" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pattern" })).toHaveAttribute("aria-pressed", "false");
  });
});
