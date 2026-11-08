import { fireEvent, render, screen } from "@testing-library/react";
import { TopBar, type TopBarProps } from "./TopBar";

function setup(over: Partial<TopBarProps> = {}) {
  const p: TopBarProps = {
    tool: "select",
    onArmTool: vi.fn(),
    panel: "parts",
    onPanel: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoLabel: "",
    redoLabel: "",
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    saveEntries: [{ id: "open", label: "Open…", onSelect: vi.fn() }],
    onSave: vi.fn(),
    onExport: vi.fn(),
    onPalette: vi.fn(),
    theme: "light",
    onTheme: vi.fn(),
    onProps: vi.fn(),
    propsOpen: false,
    ...over,
  };
  render(<TopBar {...p} />);
  return p;
}

describe("Save split button", () => {
  it("saves on a click, without opening a menu", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens Share, Versions and Export from the arrow", () => {
    const p = setup({ cloud: "saved", onShare: vi.fn(), onHistory: vi.fn() });
    expect(screen.getByRole("button", { name: "Save" })).toHaveAccessibleDescription("Saved to your account");
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share, versions and export" }));
    const items = screen.getAllByRole("menuitem").map((el) => el.dataset.label);
    expect(items).toEqual(["Share…", "Versions…", "Export…", "Build steps (.zip)…", "Open…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Versions/ }));
    expect(p.onHistory).toHaveBeenCalledOnce();
  });

  it("greys out Share and Versions when the model is not in an account", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Share, versions and export" }));
    expect(screen.getByRole("menuitem", { name: /Share/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Versions/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Export/ })).toBeTruthy();
  });
});
