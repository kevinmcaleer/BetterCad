import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Button, IconButton } from "./Button";
import { NumberField, stepFor, clamp } from "./NumberField";
import { Menu, type MenuEntry } from "./Menu";
import { Dialog } from "./Dialog";
import { Banner } from "./Banner";
import { Toolbar, Separator } from "./Toolbar";
import { Icon } from "./Icon";
import { Rail } from "./Rail";

describe("Button", () => {
  it("puts the shortcut in the tooltip and reflects pressed state", () => {
    render(<Button icon="move" label="Move" title="Move the part" shortcut="M" on />);
    const b = screen.getByRole("button", { name: "Move" });
    expect(b).toHaveAttribute("title", "Move the part (M)");
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(b).toHaveClass("bc-btn", "bc-on");
  });
  it("names an icon-only button from its title", () => {
    render(<Button icon="undo" title="Undo" shortcut="Ctrl+Z" />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute("title", "Undo (Ctrl+Z)");
  });
  it("leaves aria-pressed off plain actions", () => {
    render(<IconButton icon="eye" title="Hide" />);
    expect(screen.getByRole("button", { name: "Hide" })).not.toHaveAttribute("aria-pressed");
  });
});

describe("Icon", () => {
  it("renders a decorative svg", () => {
    const { container } = render(<Icon name="extrude" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.getAttribute("data-icon")).toBe("extrude");
  });
});

describe("NumberField", () => {
  function Harness({ start = 10 }: { start?: number }) {
    const [v, setV] = useState(start);
    return <NumberField label="Width" value={v} onChange={setV} min={0} />;
  }
  it("steps with arrows, Shift x10 and Alt x0.1", () => {
    render(<Harness />);
    const input = screen.getByRole("spinbutton", { name: "Width (mm)" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue(11);
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(input).toHaveValue(21);
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    expect(input).toHaveValue(20.9);
  });
  it("clamps to the minimum", () => {
    render(<Harness start={5} />);
    const input = screen.getByRole("spinbutton", { name: "Width (mm)" });
    fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
    expect(input).toHaveValue(0);
  });
  it("has pure helpers", () => {
    expect(stepFor(1, { shiftKey: true, altKey: false })).toBe(10);
    expect(stepFor(1, { shiftKey: false, altKey: true })).toBe(0.1);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

describe("Menu", () => {
  const entries = (pick: (id: string) => void): MenuEntry[] => [
    { id: "a", label: "Rename", onSelect: () => pick("a") },
    { kind: "separator", id: "s" },
    { id: "b", label: "Delete", danger: true, keys: "Del", onSelect: () => pick("b") },
  ];
  it("focuses the first item, moves with arrows and picks with Enter", async () => {
    const picked: string[] = [];
    const onClose = vi.fn();
    render(<Menu open label="Part" onClose={onClose} entries={entries((id) => picked.push(id))} />);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(picked).toEqual(["b"]);
    expect(onClose).toHaveBeenCalled();
  });
  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Menu open label="Part" onClose={onClose} entries={entries(() => {})} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Dialog", () => {
  it("is labelled by its title, focuses inside and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Rename" onClose={onClose} footer={<button>Done</button>}>
        <input aria-label="Name" />
      </Dialog>,
    );
    const dlg = screen.getByRole("dialog", { name: "Rename" });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} title="X" onClose={() => {}}>
        x
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Toolbar, Banner and Rail", () => {
  it("renders a named toolbar with separators", () => {
    render(
      <Toolbar label="View tools">
        <Button label="Fit" />
        <Separator />
        <Button label="Top" />
      </Toolbar>,
    );
    expect(screen.getByRole("toolbar", { name: "View tools" })).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
  it("announces a banner", () => {
    render(<Banner>Out of date</Banner>);
    expect(screen.getByRole("status")).toHaveTextContent("Out of date");
  });
  it("marks the pressed rail item", async () => {
    const onChange = vi.fn();
    render(
      <Rail
        value="parts"
        onChange={onChange}
        items={[
          { id: "parts", icon: "layers", label: "Parts" },
          { id: "sketch", icon: "sketch", label: "Sketch" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Parts" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Sketch" }));
    expect(onChange).toHaveBeenCalledWith("sketch");
  });
});
