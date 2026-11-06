import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Button, IconButton, ToolButton } from "./Button";
import { NumberField, stepFor, clamp, scrubValue } from "./NumberField";
import { Menu, type MenuEntry } from "./Menu";
import { Dialog } from "./Dialog";
import { Banner } from "./Banner";
import { Toolbar, Separator } from "./Toolbar";
import { Icon } from "./Icon";
import { Rail } from "./Rail";
import { PartsTree, type TreeItem } from "./PartsTree";
import { PropsPanel } from "./PropsPanel";
import { TooltipLayer } from "./Tooltip";

describe("Button", () => {
  it("puts the shortcut in the tooltip and reflects pressed state", () => {
    render(<Button icon="move" label="Move" title="Move the part" shortcut="M" on />);
    const b = screen.getByRole("button", { name: "Move" });
    expect(b).toHaveAttribute("data-tip", "Move the part (M)");
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(b).toHaveClass("bc-btn", "bc-on");
  });
  it("names an icon-only button from its title", () => {
    render(<Button icon="undo" title="Undo" shortcut="Ctrl+Z" />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute("data-tip", "Undo (Ctrl+Z)");
  });
  it("stays focusable when disabled and ignores clicks", async () => {
    const onClick = vi.fn();
    render(<Button label="Save" disabled onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toHaveAttribute("aria-disabled", "true");
    expect(b).not.toBeDisabled();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("ignores clicks while busy", async () => {
    const onClick = vi.fn();
    render(<Button label="Save" busy onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });
  it("leaves aria-pressed off plain actions", () => {
    render(<IconButton icon="eye" title="Hide" />);
    expect(screen.getByRole("button", { name: "Hide" })).not.toHaveAttribute("aria-pressed");
  });
  it("gives a tool button its pressed state and a Label (K) tooltip", async () => {
    const onPress = vi.fn();
    render(<ToolButton icon="move" label="Move" shortcut="M" pressed={false} onPress={onPress} />);
    const b = screen.getByRole("button", { name: "Move" });
    expect(b).toHaveAttribute("aria-pressed", "false");
    expect(b).toHaveAttribute("data-tip", "Move (M)");
    await userEvent.click(b);
    expect(onPress).toHaveBeenCalled();
  });
});

describe("Tooltip", () => {
  it("shows the data-tip after a pause and hides on a key", () => {
    vi.useFakeTimers();
    try {
      render(
        <>
          <Button label="Move" title="Move" shortcut="M" />
          <TooltipLayer />
        </>,
      );
      fireEvent.pointerOver(screen.getByRole("button", { name: "Move" }));
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => void vi.advanceTimersByTime(450));
      expect(screen.getByRole("tooltip")).toHaveTextContent("Move (M)");
      fireEvent.keyDown(document.body, { key: "a" });
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
  function Harness({ start = 10, onCommit }: { start?: number | null; onCommit?: (v: number, expr?: string) => void }) {
    const [v, setV] = useState<number | null>(start);
    return <NumberField label="Width" value={v} onChange={setV} onCommit={onCommit} min={0} scope={{ wall: 2 }} />;
  }
  const field = () => screen.getByRole("textbox", { name: "Width (mm)" });

  it("steps with arrows, Shift x10 and Alt x0.1", () => {
    render(<Harness />);
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(field()).toHaveValue("11");
    fireEvent.keyDown(field(), { key: "ArrowUp", shiftKey: true });
    expect(field()).toHaveValue("21");
    fireEvent.keyDown(field(), { key: "ArrowDown", altKey: true });
    expect(field()).toHaveValue("20.9");
  });
  it("clamps to the minimum", () => {
    render(<Harness start={5} />);
    fireEvent.keyDown(field(), { key: "ArrowDown", shiftKey: true });
    expect(field()).toHaveValue("0");
  });
  it("works out a sum on Enter and remembers it", async () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "40/2 + wall{Enter}");
    expect(field()).toHaveValue("22");
    expect(onCommit).toHaveBeenCalledWith(22, "40/2 + wall");
    expect(field()).toHaveAttribute("data-tip", "= 40/2 + wall");
  });
  it("converts units", async () => {
    render(<Harness />);
    await userEvent.clear(field());
    await userEvent.type(field(), "1in{Enter}");
    expect(field()).toHaveValue("25.4");
  });
  it("explains a bad entry and Esc puts the old value back", async () => {
    render(<Harness />);
    await userEvent.clear(field());
    await userEvent.type(field(), "4 +{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/Type a number|Can't read/);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    await userEvent.keyboard("{Escape}");
    expect(field()).toHaveValue("10");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows a dash when the selection's values differ", () => {
    render(<Harness start={null} />);
    expect(field()).toHaveValue("");
    expect(field()).toHaveAttribute("placeholder", "–");
  });
  it("has pure helpers", () => {
    expect(stepFor(1, { shiftKey: true, altKey: false })).toBe(10);
    expect(stepFor(1, { shiftKey: false, altKey: true })).toBe(0.1);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(scrubValue(10, 9, 1)).toBe(12);
    expect(scrubValue(10, -4, 1)).toBe(9);
  });
});

describe("Menu", () => {
  const entries = (pick: (id: string) => void): MenuEntry[] => [
    { id: "a", label: "Rename", onSelect: () => pick("a") },
    { id: "c", label: "Duplicate", onSelect: () => pick("c") },
    { kind: "separator", id: "s" },
    { id: "b", label: "Delete", danger: true, keys: "Del", onSelect: () => pick("b") },
  ];
  it("focuses the first item, moves with arrows and picks with Enter", async () => {
    const picked: string[] = [];
    const onClose = vi.fn();
    render(<Menu open label="Part" onClose={onClose} entries={entries((id) => picked.push(id))} />);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(picked).toEqual(["b"]);
    expect(onClose).toHaveBeenCalled();
  });
  it("jumps to an item by typing its first letter", async () => {
    render(<Menu open label="Part" onClose={() => {}} entries={entries(() => {})} />);
    await userEvent.keyboard("d");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
  });
  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Menu open label="Part" onClose={onClose} entries={entries(() => {})} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Dialog", () => {
  it("is labelled by its title, focuses inside, Esc cancels and Enter is Done", async () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    render(
      <Dialog open modal title="Rename" onCancel={onCancel} onDone={onDone}>
        <input aria-label="Name" />
      </Dialog>,
    );
    const dlg = screen.getByRole("dialog", { name: "Rename" });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onDone).toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });
  it("has Cancel and Done by default", async () => {
    const onCancel = vi.fn();
    render(
      <Dialog open title="Extrude" onCancel={onCancel} onDone={() => {}}>
        x
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Extrude" })).not.toHaveAttribute("aria-modal");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} title="X" onCancel={() => {}}>
        x
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Toolbar, Banner and Rail", () => {
  it("renders a named toolbar with separators and roves focus with arrows", async () => {
    render(
      <Toolbar label="View tools">
        <Button label="Fit" />
        <Separator />
        <Button label="Top" />
      </Toolbar>,
    );
    expect(screen.getByRole("toolbar", { name: "View tools" })).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Fit" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Top" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "Fit" })).toHaveFocus();
  });
  it("announces banners, and an error loudly", () => {
    render(
      <>
        <Banner tone="warn">Out of date</Banner>
        <Banner tone="danger">The fillet is too big</Banner>
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Warning");
    expect(screen.getByRole("status")).toHaveTextContent("Out of date");
    expect(screen.getByRole("alert")).toHaveTextContent("Error");
  });
  it("marks the pressed rail item and folds when it is clicked again", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: "Parts" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("PartsTree", () => {
  const ITEMS: TreeItem[] = [
    { id: "a", name: "Plate" },
    { id: "b", name: "Bracket" },
    { id: "c", name: "Lid" },
    { id: "d", name: "Screw", parentId: "c" },
  ];
  function Harness({ onRename, onToggle }: { onRename?: (id: string, name: string) => void; onToggle?: (id: string, what: string) => void }) {
    const [sel, setSel] = useState<string[]>([]);
    return <PartsTree label="Parts" items={ITEMS} selection={sel} onSelect={setSel} onRename={onRename} onToggle={onToggle} />;
  }
  const row = (name: string) => screen.getByRole("treeitem", { name: new RegExp(`^${name}`) });

  it("selects with a click, Shift for a range and Ctrl to add one", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Plate"));
    expect(row("Plate")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByText("Plate"));
    fireEvent.click(screen.getByText("Lid"), { shiftKey: true });
    expect(row("Plate")).toHaveAttribute("aria-selected", "true");
    expect(row("Bracket")).toHaveAttribute("aria-selected", "true");
    expect(row("Lid")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByText("Bracket"), { ctrlKey: true });
    expect(row("Bracket")).toHaveAttribute("aria-selected", "false");
  });
  it("is a tree with nesting levels", () => {
    render(<Harness />);
    expect(screen.getByRole("tree", { name: "Parts" })).toHaveAttribute("aria-multiselectable", "true");
    expect(row("Screw")).toHaveAttribute("aria-level", "2");
  });
  it("moves with arrows and renames inline with F2", async () => {
    const onRename = vi.fn();
    render(<Harness onRename={onRename} />);
    await userEvent.click(screen.getByText("Plate"));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.closest("[role=treeitem]")).toBe(row("Bracket"));
    await userEvent.keyboard("{F2}");
    const box = screen.getByRole("textbox", { name: "Rename Bracket" });
    await userEvent.clear(box);
    await userEvent.type(box, "Arm{Enter}");
    expect(onRename).toHaveBeenCalledWith("b", "Arm");
  });
  it("toggles visibility from the row button", async () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Hide Plate" })[0]!);
    expect(onToggle).toHaveBeenCalledWith("a", "hidden");
  });
});

describe("PropsPanel", () => {
  it("shows the empty state with nothing selected", () => {
    render(<PropsPanel sections={[]} empty={<p>Select something to see its properties.</p>} />);
    expect(screen.getByText("Select something to see its properties.")).toBeInTheDocument();
  });
  it("folds a section and remembers it", async () => {
    localStorage.clear();
    const sections = [{ id: "size", title: "Size", content: <p>Width</p> }];
    const { unmount } = render(<PropsPanel sections={sections} />);
    const toggle = screen.getByRole("button", { name: "Size" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Width")).toBeNull();
    unmount();
    render(<PropsPanel sections={sections} />);
    expect(screen.getByRole("button", { name: "Size" })).toHaveAttribute("aria-expanded", "false");
  });
});
