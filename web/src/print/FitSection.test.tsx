import { fireEvent, render, screen } from "@testing-library/react";
import { PrintPanel, type PrintPanelProps } from "./PrintPanel";
import { PRINTERS } from "../state/document";

function setup(settings: PrintPanelProps["settings"] = {}) {
  const onChange = vi.fn();
  const onCalibrateFits = vi.fn();
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
    />,
  );
  return { onChange, onCalibrateFits };
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
