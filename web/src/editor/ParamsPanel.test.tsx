import { fireEvent, render, screen, within } from "@testing-library/react";
import { addParam, addPart, addSketch, newDoc, updateSketch, type ModelDoc } from "../state/document";
import { drawRectangle } from "@bettercad/sketch";
import { ParamsDialog } from "./ParamsPanel";

function setup(base?: ModelDoc) {
  const doc = base ?? addParam(addPart(newDoc(), "box", "a"), { name: "a_long_parameter_name", expression: "4 * 5", comment: "Wall" });
  const props = {
    doc,
    onAdd: vi.fn(),
    onChange: vi.fn(),
    onRemove: vi.fn(),
    onShowUses: vi.fn(),
    onEdit: vi.fn(),
    say: vi.fn(),
    onClose: vi.fn(),
  };
  render(<ParamsDialog {...props} />);
  return props;
}

describe("ParamsDialog", () => {
  it("is a dialog with user parameters and each step's sizes", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Parameters" });
    expect(within(dialog).getByRole("textbox", { name: "Name of a_long_parameter_name" })).toHaveValue("a_long_parameter_name");
    expect(within(dialog).getByRole("textbox", { name: "Comment for a_long_parameter_name" })).toHaveValue("Wall");
    expect(within(dialog).getByRole("cell", { name: "Value of a_long_parameter_name" })).toHaveTextContent("20 mm");
    expect(within(dialog).getByRole("button", { name: /User parameters/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("button", { name: /Model parameters/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a step to show and change its sizes", () => {
    const { doc, onEdit } = setup();
    const step = screen.getByRole("button", { name: /Box 1/ });
    expect(step).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Width of Box 1" })).toBeNull();
    fireEvent.click(step);
    const width = screen.getByRole("textbox", { name: "Width of Box 1" });
    fireEvent.change(width, { target: { value: "a_long_parameter_name + 1" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith("Edit Box 1", expect.any(Function));
    const next = (onEdit.mock.calls[0]![1] as (d: typeof doc) => typeof doc)(doc);
    const f = next.features[0]!;
    expect(f.type === "add" && f.part.size.x).toBe(21);
    expect(f.exprs).toEqual({ "part.size.x": "a_long_parameter_name + 1" });
  });

  it("filters both sections", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter parameters" }), { target: { value: "height" } });
    expect(screen.queryByRole("textbox", { name: "Name of a_long_parameter_name" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Height of Box 1" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Width of Box 1" })).toBeNull();
  });

  it("closes from its close button", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close (Esc)" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("names sketch sizes and renames them everywhere", () => {
    let base = addSketch(newDoc(), { kind: "world", plane: "XY", offset: 0 }, "s");
    base = updateSketch(base, "s", (s) => drawRectangle(s, [0, 0], [40, 20], { width: 40, height: 20 }).sketch);
    base = updateSketch(base, "s", (s) => ({ ...s, dimensions: s.dimensions.map((x) => (x.name === "d2" ? { ...x, expression: "d1 / 2" } : x)) }));
    const { doc, onEdit, say } = setup(base);
    fireEvent.click(screen.getByRole("button", { name: /Sketch 1/ }));
    const name = screen.getByRole("textbox", { name: /^Name of .* 1 of Sketch 1$/ });
    expect(name).toHaveValue("d1");
    fireEvent.change(name, { target: { value: "d2" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(say).toHaveBeenCalledWith("There is already a size called d2", true);
    fireEvent.change(name, { target: { value: "wide" } });
    fireEvent.keyDown(name, { key: "Enter" });
    const next = (onEdit.mock.calls[0]![1] as (d: ModelDoc) => ModelDoc)(doc);
    const f = next.features[0]!;
    expect(f.type === "sketch" && f.sketch.dimensions.map((x) => [x.name, x.expression])).toEqual([
      ["wide", expect.any(String)],
      ["d2", "wide / 2"],
    ]);
  });
});
