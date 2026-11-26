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

describe("New model button", () => {
  it("sits beside Save so starting over is easy to find", () => {
    const onNewModel = vi.fn();
    setup({ onNewModel });
    fireEvent.click(screen.getByRole("button", { name: "New model" }));
    expect(onNewModel).toHaveBeenCalledOnce();
  });

  it("stays in the Save menu on a phone", () => {
    setup({ onNewModel: vi.fn(), phone: true });
    expect(screen.queryByRole("button", { name: "New model" })).toBeNull();
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
  it("takes Parameters and Help on a phone, where their buttons leave the bar", () => {
    const help = vi.fn();
    const p = setup({ phone: true, onParams: vi.fn(), helpEntries: [{ id: "about", label: "About BetterCad", onSelect: help }] });
    expect(screen.queryByRole("button", { name: "Parameters" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Account and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Parameters/ }));
    expect(p.onParams).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Account and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /About BetterCad/ }));
    expect(help).toHaveBeenCalledOnce();
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

  it("has a Drawing tab, which an open drawing's own tools take over in place", () => {
    setup({ ribbon: (t) => <span>{t} tools</span> });
    fireEvent.click(screen.getByRole("tab", { name: "Drawing" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("drawing tools");
  });

  it("shows one Drawing tab, in its place, while a drawing is open", () => {
    setup({ ribbon: () => <span>model</span>, drawingRibbon: <button type="button">Parts list</button> });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Model", "Assemble", "Inspect", "Drawing", "Electronics"]);
    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("toolbar", { name: "Drawing tools" })).toContainElement(screen.getByRole("button", { name: "Parts list" }));
  });

  it("opens the Render view from a Render tab, whose options then take the tab over", () => {
    const onRender = vi.fn();
    setup({ ribbon: (t) => <span>{t} tools</span>, onRender });
    fireEvent.click(screen.getByRole("tab", { name: "Render" }));
    expect(onRender).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the Render view's options on its tab while it is open", () => {
    setup({ ribbon: () => <span>model</span>, onRender: vi.fn(), renderRibbon: <button type="button">Lighting</button> });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Model", "Assemble", "Inspect", "Drawing", "Render", "Electronics"]);
    expect(tabs[4]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("toolbar", { name: "Render tools" })).toContainElement(screen.getByRole("button", { name: "Lighting" }));
  });

  it("leaves the Render view when you choose another tab, with no Done needed", () => {
    const onLeaveRender = vi.fn();
    setup({ ribbon: (t) => <span>{t} tools</span>, onRender: vi.fn(), onLeaveRender, renderRibbon: <button type="button">Lighting</button> });
    const assemble = screen.getByRole("tab", { name: "Assemble" });
    expect(assemble).toBeEnabled();
    fireEvent.click(assemble);
    expect(onLeaveRender).toHaveBeenCalledOnce();
  });

  it("the Electronics tab shows the open view's tools while the schematic or the board is open (#617)", () => {
    setup({ ribbon: () => <span>model</span>, electronicsRibbon: <button type="button">Wire</button> });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Model", "Assemble", "Inspect", "Drawing", "Electronics"]);
    expect(tabs[4]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toBeDisabled();
    expect(screen.getByRole("toolbar", { name: "Electronics tools" })).toContainElement(screen.getByRole("button", { name: "Wire" }));
  });

  it("keeps the compact bar for a shared model", () => {
    setup({ ribbon: () => <span>tools</span>, shared: { owner: "Kev" } });
    expect(screen.queryByRole("tab")).toBeNull();
  });
});

describe("More tools", () => {
  it("ends the compact tool bar with More tools, which opens the ribbon's tabs", () => {
    const p = setup({ onMoreTools: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    expect(p.onMoreTools).toHaveBeenCalledOnce();
  });

  it("leaves it off when there is nothing to open", () => {
    setup();
    expect(screen.queryByRole("button", { name: "More tools" })).toBeNull();
  });
});
