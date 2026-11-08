import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Call, Clash, SweepResult } from "@bettercad/kernel";
import { addJoint, addLink, addPart, newDoc, type ModelDoc } from "../state/document";
import { createStore } from "../state/store";
import { ClashList, limitText, volumeText, type ClashListProps, type ClashSweepProps } from "./ClashList";

const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
const names: Record<string, string> = { a: "Upper arm", b: "Base", c: "Gripper" };
const props = (change: Partial<ClashListProps> = {}): ClashListProps => ({
  on: true,
  onToggle: vi.fn(),
  sameLink: false,
  references: false,
  onOptions: vi.fn(),
  progress: null,
  clashes: null,
  nameOf: (id) => names[id]!,
  onShow: vi.fn(),
  onStop: vi.fn(),
  ...change,
});

describe("ClashList (#178)", () => {
  it("writes volumes in cm³, or mm³ when small", () => {
    expect(volumeText(800)).toBe("0.8 cm³");
    expect(volumeText(12_340)).toBe("12.3 cm³");
    expect(volumeText(40.04)).toBe("40 mm³");
  });

  it("lists overlaps and touches, and Show frames one", async () => {
    const overlap: Clash = { a: "a", b: "b", kind: "overlap", volume: 800, centre: [0, 0, 0], box };
    const touch: Clash = { a: "c", b: "b", kind: "touch", volume: 0, centre: [0, 0, 0], box };
    const p = props({ clashes: [overlap, touch] });
    render(<ClashList {...p} />);
    const overlaps = screen.getByRole("list", { name: "Overlaps" });
    expect(overlaps).toHaveTextContent("Upper arm and Base overlap by 0.8 cm³");
    expect(screen.getByRole("list", { name: "Touching" })).toHaveTextContent("Gripper and Base touch");
    await userEvent.click(screen.getAllByRole("button", { name: "Show" })[0]!);
    expect(p.onShow).toHaveBeenCalledWith(overlap);
  });

  it("says when nothing clashes, and shows progress with Stop while it checks", async () => {
    const { rerender } = render(<ClashList {...props({ clashes: [] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("No clashes at this pose.");
    const p = props({ progress: 0.4 });
    rerender(<ClashList {...p} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking, 40%");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(p.onStop).toHaveBeenCalled();
  });

  it("turns on and off, and sets which bodies count", async () => {
    const p = props({ on: false });
    const { rerender } = render(<ClashList {...p} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check clashes" }));
    expect(p.onToggle).toHaveBeenCalledWith(true);
    rerender(<ClashList {...props({ onOptions: p.onOptions })} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Reference bodies" }));
    expect(p.onOptions).toHaveBeenCalledWith({ references: true });
  });
});

describe("ClashSweep (#179)", () => {
  let arm = addLink(addPart(addPart(newDoc("Arm"), "box", "a"), "box", "b"), ["b"], "l");
  arm = addJoint(arm, { kind: "revolute", child: "l", parent: null, origin: [0, 0, 0], axis: [0, 0, 1], lower: -90, upper: 90 }, "s");
  /** A kernel call the test settles, with cancel. */
  const pending = () => {
    let settle!: (r: SweepResult) => void;
    const p = new Promise<SweepResult>((res) => (settle = res)) as Call<SweepResult>;
    p.cancel = vi.fn();
    return { call: p, settle };
  };
  const sweep = (change: Partial<ClashSweepProps> = {}): ClashSweepProps => ({
    joints: [
      { id: "s", name: "Shoulder", kind: "revolute" },
      { id: "e", name: "Elbow", kind: "revolute" },
    ],
    run: vi.fn(() => null),
    model: 1,
    start: 0,
    store: createStore<ModelDoc>(arm),
    onShow: vi.fn(),
    say: vi.fn(),
    ...change,
  });

  it("writes suggested limits", () => {
    expect(limitText({ joint: "s", upper: 70 }, "revolute")).toBe("Set the upper limit to 70°");
    expect(limitText({ joint: "s", lower: 2 }, "prismatic")).toBe("Set the lower limit to 2 mm");
    expect(limitText({ joint: "s", lower: -10, upper: 70 }, "revolute")).toBe("Set the limits to -10° and 70°");
  });

  it("sweeps, lists where bodies hit, shows the first clash and sets the limit", async () => {
    const k = pending();
    const s = sweep({ run: vi.fn(() => k.call) });
    render(<ClashList {...props({ on: false, sweep: s })} />);
    await userEvent.click(screen.getByRole("button", { name: "Sweep" }));
    expect(s.run).toHaveBeenCalledWith({ joint: "each", step: { hinge: 5, slider: 1 }, samples: 200 }, expect.any(Function));
    await act(async () =>
      k.settle({
        samples: 37,
        ranges: [{ joint: "s", a: "b", b: "a", from: 72, to: 90, first: 72, at: { s: 72 } }],
        together: [],
        limits: [{ joint: "s", upper: 70 }],
      }),
    );
    expect(s.say).toHaveBeenCalledWith("Found 1 clash while sweeping");
    expect(screen.getByRole("list", { name: "Hits" })).toHaveTextContent("Upper arm hits Base from 72° to 90° on Shoulder");
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(s.onShow).toHaveBeenCalledWith({ s: 72 });
    expect(s.store.get().pose).toEqual({ s: 72 });
    await userEvent.click(screen.getByRole("button", { name: "Set the upper limit to 70°" }));
    expect(s.store.get().features.find((f) => f.id === "s")).toMatchObject({ lower: -90, upper: 70 });
    expect(s.say).toHaveBeenCalledWith("Set the limits of Shoulder");
  });

  it("sweeps all joints together with a pose count, and shows progress with Stop", async () => {
    const k = pending();
    let progress: (f: number) => void = () => {};
    const s = sweep({
      run: vi.fn((_ask, p) => {
        progress = p;
        return k.call;
      }),
    });
    render(<ClashList {...props({ on: false, sweep: s })} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Move" }), "together");
    expect(screen.getByRole("textbox", { name: /Poses/ })).toHaveValue("200");
    await userEvent.click(screen.getByRole("button", { name: "Sweep" }));
    expect(s.run).toHaveBeenCalledWith(expect.objectContaining({ joint: "together", samples: 200 }), expect.any(Function));
    act(() => progress(0.25));
    expect(screen.getByRole("status")).toHaveTextContent("Sweeping, 25%");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(k.call.cancel).toHaveBeenCalled();
    expect(s.say).toHaveBeenCalledWith("Stopped sweeping");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lists pairs that hit together, says when nothing hits, and clears for a new model", async () => {
    const k = pending();
    const s = sweep({ run: vi.fn(() => k.call) });
    const { rerender } = render(<ClashList {...props({ on: false, sweep: s })} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Move" }), "together");
    await userEvent.click(screen.getByRole("button", { name: "Sweep" }));
    await act(async () => k.settle({ samples: 200, ranges: [], together: [{ a: "b", b: "c", count: 12, at: { s: 30, e: 40 } }], limits: [] }));
    expect(screen.getByRole("list", { name: "Hits" })).toHaveTextContent("Gripper hits Base in 12 of 200 poses");
    rerender(<ClashList {...props({ on: false, sweep: { ...s, model: 2 } })} />);
    expect(screen.queryByRole("list", { name: "Hits" })).toBeNull();

    const none = pending();
    const t = sweep({ run: vi.fn(() => none.call), start: 0 });
    rerender(<ClashList {...props({ on: false, sweep: t })} />);
    // The palette's command starts it.
    rerender(<ClashList {...props({ on: false, sweep: { ...t, start: 1 } })} />);
    expect(t.run).toHaveBeenCalled();
    await act(async () => none.settle({ samples: 200, ranges: [], together: [], limits: [] }));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing hits in 200 poses.");
  });
});
