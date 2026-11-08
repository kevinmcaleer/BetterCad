import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BodyMesh } from "@bettercad/kernel";
import { FinishBar, edgeLength, formatMm } from "./FinishBar";
import type { FinishSession } from "./useFinish";

function session(over: Partial<FinishSession> = {}): FinishSession {
  return {
    tool: "fillet",
    part: "p1",
    partName: "Body 1",
    refs: [4, 7],
    kind: "edge",
    // Edge 4 runs 70 mm along X, edge 7 58 mm along Y.
    mesh: {
      edgePositions: new Float32Array([0, 0, 0, 70, 0, 0, 0, 0, 0, 0, 58, 0]),
      edgeSegs: new Uint32Array([0, 0, 0, 0, 0, 1, 1, 1, 2]),
    } as BodyMesh,
    drop: vi.fn(),
    point: vi.fn(),
    clear: vi.fn(),
    bevel: false,
    setBevel: vi.fn(),
    radius: 4,
    setRadius: vi.fn(),
    done: vi.fn(),
    ...over,
  } as unknown as FinishSession;
}

describe("FinishBar's pick list", () => {
  it("lists the picked edges and takes one out", async () => {
    const f = session();
    render(<FinishBar f={f} onCancel={() => {}} />);
    const list = screen.getByRole("group", { name: "Picked edges" });
    expect(list).toHaveTextContent("Edge 1, 70 mm");
    expect(list).toHaveTextContent("Edge 2, 58 mm");
    await userEvent.click(screen.getByRole("button", { name: "Take Edge 2 out" }));
    expect(f.drop).toHaveBeenCalledWith(7);
    await userEvent.click(screen.getByRole("button", { name: "Take every edge out" }));
    expect(f.clear).toHaveBeenCalled();
  });

  it("hides the list from the count and shows why the preview fails", async () => {
    render(<FinishBar f={session()} preview={{ bodies: null, error: "The radius is too big.", busy: false }} onCancel={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The radius is too big.");
    // The Edges row's "2 selected" folds the list away; its × takes every edge out.
    const edges = within(screen.getByRole("group", { name: "Edges" }));
    await userEvent.click(edges.getByRole("button", { name: "2 selected" }));
    expect(screen.queryByRole("group", { name: "Picked edges" })).toBeNull();
  });
});

describe("edgeLength", () => {
  it("adds up an edge's segments", () => {
    const m = { edgePositions: new Float32Array([0, 0, 0, 3, 4, 0, 3, 4, 0, 3, 4, 10, 9, 9, 9, 9, 9, 9]), edgeSegs: new Uint32Array([0, 2, 3]) } as BodyMesh;
    expect(edgeLength(m, 0)).toBe(15);
    expect(edgeLength(m, 1)).toBe(0);
    expect(edgeLength(m, 2)).toBeNull();
    expect(formatMm(12.345)).toBe("12.3 mm");
    expect(formatMm(70)).toBe("70 mm");
  });
});
