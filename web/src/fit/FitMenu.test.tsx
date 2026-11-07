import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FitMenu, NO_FIT, choiceGap, choiceLabel, type FitChoice } from "./FitMenu";
import { CombineBar } from "../editor/CombineBar";
import { build, addPart, newDoc } from "../state/document";

function Harness({ start = NO_FIT, onChange = vi.fn() }: { start?: FitChoice; onChange?: (c: FitChoice) => void }) {
  const [v, setV] = useState(start);
  return (
    <FitMenu
      value={v}
      tuned={{ sliding: 0.3 }}
      onChange={(c) => {
        setV(c);
        onChange(c);
      }}
    />
  );
}

describe("FitMenu (#183)", () => {
  it("lists the named fits with the printer's gaps and picks one", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /No gap/ }));
    expect(screen.getByRole("menuitemradio", { name: "Press fit, 0.15 mm gap each side" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Sliding fit, 0.3 mm gap each side" }));
    expect(onChange).toHaveBeenLastCalledWith({ fit: "sliding", gap: 0 });
    expect(screen.getByRole("button", { name: /Sliding fit, 0.3 mm gap each side/ })).toBeTruthy();
  });

  it("takes a custom gap from a field", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /No gap/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Custom gap" }));
    expect(screen.getByLabelText("Gap")).toBeTruthy();
    expect(screen.getByRole("button", { name: /0.3 mm gap each side/ })).toBeTruthy();
  });

  it("works out the gap and the label", () => {
    expect(choiceGap({ fit: "loose", gap: 0 })).toBe(0.4);
    expect(choiceGap({ fit: null, gap: 0.2 })).toBe(0.2);
    expect(choiceLabel(NO_FIT)).toBe("No gap");
  });
});

describe("CombineBar fit", () => {
  const parts = build(addPart(addPart(newDoc(), "box", "a"), "box", "b")).parts;
  const props = { picked: parts, keepTools: false, onKeepTools: vi.fn(), fit: NO_FIT, onFit: vi.fn(), onOp: vi.fn(), onApply: vi.fn(), onCancel: vi.fn() };

  it("offers a fit only when cutting", () => {
    const { rerender } = render(<CombineBar {...props} op="join" />);
    expect(screen.queryByRole("button", { name: /No gap/ })).toBeNull();
    rerender(<CombineBar {...props} op="cut" />);
    expect(screen.getByRole("button", { name: /No gap/ })).toBeTruthy();
  });
});
