import { fireEvent, render, screen } from "@testing-library/react";
import { PrintPanel, type PrintPanelProps } from "./PrintPanel";
import { PRINTERS, profileFromSettings } from "../state/document";

function setup(settings: PrintPanelProps["settings"] = {}, extra: Partial<PrintPanelProps> = {}) {
  const onChange = vi.fn();
  const onCalibrateFits = vi.fn();
  const onSaveProfile = vi.fn();
  const onPickProfile = vi.fn();
  const noop = () => {};
  render(
    <PrintPanel
      settings={settings}
      printer={PRINTERS[0]!}
      onChange={onChange}
      showBed
      onShowBed={noop}
      fitProblem={null}
      hasModel={false}
      onCentre={noop}
      weight={null}
      check="none"
      onCheck={noop}
      overhangAngle={45}
      onOverhangAngle={noop}
      thinWall={0.8}
      onThinWall={noop}
      areas={[]}
      onShowArea={noop}
      suggestions={null}
      onSuggestion={noop}
      holeOffset={0.4}
      staleHoles={0}
      onUpdateHoles={noop}
      onCalibrate={noop}
      onCalibrateFits={onCalibrateFits}
      profiles={[]}
      onPickProfile={onPickProfile}
      onSaveProfile={onSaveProfile}
      onUpdateProfile={noop}
      onDeleteProfile={noop}
      staleFits={0}
      onUpdateFits={noop}
      fitsCheck={false}
      onFitsCheck={noop}
      mates={null}
      partName={(id) => ({ plate: "Plate", pin: "Pin" })[id] ?? id}
      onShowMate={noop}
      onFixMate={noop}
      {...extra}
    />,
  );
  return { onChange, onCalibrateFits, onSaveProfile, onPickProfile };
}

describe("Print panel fits (#181, #182)", () => {
  it("shows each fit's gap, tuned or default", () => {
    setup({ fits: { sliding: 0.3 } });
    expect((screen.getByLabelText("Press") as HTMLInputElement).value).toBe("0.15");
    expect((screen.getByLabelText("Sliding") as HTMLInputElement).value).toBe("0.3");
    expect((screen.getByLabelText("Loose") as HTMLInputElement).value).toBe("0.4");
  });

  it("opens the coupon, then sets the fits from the slots", () => {
    const { onChange, onCalibrateFits } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Calibrate fits/ }));
    expect(onCalibrateFits).toHaveBeenCalled();
    const set = screen.getByRole("button", { name: /Set fits/ });
    expect(set.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByLabelText("Which slot did the peg press into?"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Which slot did it slide freely in?"), { target: { value: "3" } });
    fireEvent.click(set);
    expect(onChange).toHaveBeenLastCalledWith({ fits: { press: 0.1, sliding: 0.2, loose: 0.35 } });
  });
});

describe("Print panel printers (#180)", () => {
  it("saves this model's settings as a named printer", () => {
    const { onSaveProfile } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Save as a printer/ }));
    fireEvent.change(screen.getByLabelText("Printer name"), { target: { value: "My A1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(onSaveProfile).toHaveBeenCalledWith("My A1");
  });

  it("picks a saved printer, and offers to save changes made since", () => {
    const p = profileFromSettings("p1", "My A1", { printer: "bambu-a1", fits: { sliding: 0.2 } });
    const onUpdateProfile = vi.fn();
    const { onPickProfile } = setup({ profile: "p1", printer: "bambu-a1", fits: { sliding: 0.3 } }, { profiles: [p], onUpdateProfile });
    expect((screen.getByLabelText("My printers") as HTMLSelectElement).value).toBe("p1");
    fireEvent.click(screen.getByRole("button", { name: /Save to My A1/ }));
    expect(onUpdateProfile).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("My printers"), { target: { value: "" } });
    expect(onPickProfile).toHaveBeenCalledWith(null);
  });

  it("offers to update fitted cuts made at other gaps", () => {
    const onUpdateFits = vi.fn();
    setup({}, { staleFits: 2, onUpdateFits });
    fireEvent.click(screen.getByRole("button", { name: /Update 2 fitted cuts/ }));
    expect(onUpdateFits).toHaveBeenCalled();
  });
});

describe("Print panel fits check (#184)", () => {
  const pin = {
    kind: "pin" as const,
    a: "plate",
    b: "pin",
    faceA: 1,
    faceB: 0,
    gap: 0,
    box: { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] },
  };

  it("turns on", () => {
    const onFitsCheck = vi.fn();
    setup({}, { onFitsCheck });
    fireEvent.click(screen.getByLabelText("Check where parts meet"));
    expect(onFitsCheck).toHaveBeenCalledWith(true);
  });

  it("lists each meeting with its gap, Show and a fix when too tight", () => {
    const onFixMate = vi.fn();
    const onShowMate = vi.fn();
    setup({}, { fitsCheck: true, mates: [pin, { ...pin, kind: "faces", gap: 0.24 }], onFixMate, onShowMate });
    const list = screen.getByRole("list", { name: "Where parts meet" });
    expect(list.textContent).toContain("Pin in Plate: gap 0 mm, too tight to print");
    expect(list.textContent).toContain("Plate and Pin: sliding fit, 0.24 mm");
    fireEvent.click(screen.getByRole("button", { name: /Fix/ }));
    expect(onFixMate).toHaveBeenCalledWith(pin, "sliding");
    fireEvent.click(screen.getAllByRole("button", { name: /Show/ })[0]!);
    expect(onShowMate).toHaveBeenCalledWith(pin);
    expect(screen.getAllByRole("button", { name: /Fix/ })).toHaveLength(1);
  });

  it("says when nothing meets", () => {
    setup({}, { fitsCheck: true, mates: [] });
    expect(screen.getByText(/No printed parts meet/)).toBeTruthy();
  });
});
