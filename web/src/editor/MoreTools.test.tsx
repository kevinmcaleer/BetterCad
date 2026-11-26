import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRegistry, type Command, type CommandContext } from "../state/commands";
import { MoreTools } from "./MoreTools";

const ctx: CommandContext = { hasSelection: false, inSketch: false, toolActive: false, canUndo: false, canRedo: false, dialogOpen: false };

function setup(drawings: { id: string; name: string }[] = []) {
  const ran: string[] = [];
  const registry = createRegistry(() => ctx);
  const tool = (id: string, label: string, more: Partial<Command> = {}): Command => ({
    id,
    label,
    group: "Tools",
    icon: "extrude",
    run: () => ran.push(id),
    ...more,
  });
  registry.register([
    tool("tool.select", "Select"),
    tool("tool.extrude", "Extrude"),
    tool("tool.sweep", "Sweep"),
    tool("tool.combine", "Combine", { when: () => false }),
    tool("tool.joint", "Joint"),
    tool("drawing.new", "New drawing"),
    tool("drawing.everyPart", "A drawing of every part"),
    tool("view.render", "Render", { icon: "sun" }),
  ]);
  const onClose = vi.fn();
  const onFind = vi.fn();
  const onOpenDrawing = vi.fn();
  render(<MoreTools registry={registry} tool="extrude" panel={null} drawings={drawings} onOpenDrawing={onOpenDrawing} onFind={onFind} onClose={onClose} />);
  return { ran, onClose, onFind, onOpenDrawing };
}

describe("MoreTools", () => {
  it("shows every tool in each of the Model tab's groups, not only the pinned ones", () => {
    setup();
    const sheet = screen.getByRole("dialog", { name: "More tools" });
    expect(within(sheet).getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
    const create = within(sheet).getByRole("region", { name: "Create" });
    expect(within(create).getByRole("button", { name: "Extrude" })).toHaveAttribute("aria-pressed", "true");
    // Sweep is not pinned on the ribbon, but the sheet shows the whole group.
    expect(within(create).getByRole("button", { name: "Sweep" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Combine" })).toBeDisabled();
  });

  it("switches tabs, runs a tool and closes", () => {
    const { ran, onClose } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));
    expect(ran).toEqual(["drawing.new"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("lists the model's drawings to open, and says when there are none", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
    expect(screen.getByText("This model has no drawings yet.")).toBeInTheDocument();
  });

  it("opens a drawing from the Drawing tab", () => {
    const { onOpenDrawing } = setup([{ id: "d1", name: "Bracket" }]);
    fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Bracket" }));
    expect(onOpenDrawing).toHaveBeenCalledWith("d1");
  });

  it("moves between tabs with the arrow keys", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Model" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Model" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Assemble" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Joint" })).toBeInTheDocument();
  });

  it("opens the Render view from the Render tab, as the desktop ribbon does", () => {
    const { ran, onClose } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Render" }));
    expect(ran).toEqual(["view.render"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an Open the Render view button when you arrow onto the Render tab", () => {
    const { ran } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Drawing" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Render" })).toHaveAttribute("aria-selected", "true");
    expect(ran).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Open the Render view" }));
    expect(ran).toEqual(["view.render"]);
  });

  it("offers Find a command for anything else", () => {
    const { onFind, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Find a command" }));
    expect(onFind).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
