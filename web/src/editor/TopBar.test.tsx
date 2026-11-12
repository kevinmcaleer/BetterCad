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
    expect(items).toEqual(["Share…", "Versions…", "Export…", "Build steps (.zip)…", "Send to kevsrobots…", "Open…"]);
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

describe("Account menu", () => {
  it("offers Admin only to admins", () => {
    setup({ account: { name: "kev", admin: true } });
    fireEvent.click(screen.getByRole("button", { name: /kev: account and settings/ }));
    expect(screen.getByRole("menuitem", { name: /Admin/ })).toBeTruthy();
  });

  it("leaves Admin out for everyone else", () => {
    setup({ account: { name: "ada" } });
    fireEvent.click(screen.getByRole("button", { name: /ada: account and settings/ }));
    expect(screen.getByRole("menuitem", { name: /My models/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Admin/ })).toBeNull();
  });
});

describe("Ribbon", () => {
  it("shows tabs, and the open tab's tools from the ribbon slot", () => {
    const ribbon = vi.fn((tab: string) => <button type="button">{`${tab} tool`}</button>);
    setup({ ribbon });
    expect(screen.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("toolbar", { name: "Model tools" })).toHaveTextContent("model tool");
    fireEvent.click(screen.getByRole("tab", { name: "Assemble" }));
    expect(screen.getByRole("tab", { name: "Assemble" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("assemble tool");
  });

  it("folds the tools away on a double-click of a tab, and a click brings them back", () => {
    setup({ ribbon: () => <span>tools</span> });
    fireEvent.doubleClick(screen.getByRole("tab", { name: "Model" }));
    expect(screen.queryByRole("tabpanel")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Inspect" }));
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("puts a Sketch tab first while sketching, with the sketch tools", () => {
    setup({ ribbon: () => <span>model</span>, sketchRibbon: <button type="button">Line</button> });
    expect(screen.getByRole("tab", { name: "Sketch" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Model" })).toBeDisabled();
    expect(screen.getByRole("toolbar", { name: "Sketch tools" })).toContainElement(screen.getByRole("button", { name: "Line" }));
  });

  it("keeps the compact bar for a shared model", () => {
    setup({ ribbon: () => <span>tools</span>, shared: { owner: "Kev" } });
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
