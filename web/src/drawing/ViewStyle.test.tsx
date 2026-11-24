import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type DrawingSheet, type DrawingView } from "@bettercad/kernel/drawing";
import type { ModelView } from "@bettercad/kernel/view";
import { newDoc } from "../state/document";
import { DrawingPaper, type ViewCall } from "./DrawingView";
import type { PictureModel } from "./pictures";
import { followParent, placeProjected } from "./projected";
import { viewRequest } from "./views";
import { ViewProps } from "./ViewProps";

// Tests have no WebGL: every picture is the same small JPEG.
const shot = vi.hoisted(() =>
  vi.fn((_m: unknown, _v: unknown, _d: unknown, _s: unknown, style: string) =>
    Promise.resolve({ data: `data:image/jpeg;base64,${style}`, px: { w: 8, h: 4 } }),
  ),
);
vi.mock("./pictures", async (real) => ({ ...(await real<typeof import("./pictures")>()), viewPicture: shot }));

const front: DrawingView = { id: "f", kind: "base", shows: { all: true }, direction: "front", hidden: false, tangent: false, at: [150, 150] };
const top: DrawingView = { ...front, id: "t", kind: "projected", parent: "f", direction: "top", at: [150, 220] };
const right: DrawingView = { ...front, id: "r", kind: "projected", parent: "f", direction: "right", style: "wireframe", at: [220, 150] };
const section: DrawingView = { ...front, id: "s", kind: "section", parent: "f", at: [220, 220] };
const start: DrawingSheet = { ...newSheet("Sheet 1", { size: "A3" }), id: "sh", views: [front, top, right, section] };

function Harness({ view }: { view: string }) {
  const [sheet, setSheet] = useState(start);
  return (
    <>
      <ViewProps sheet={sheet} view={view} onSheet={(change) => setSheet(change)} />
      <output data-testid="styles">{sheet.views.map((v) => `${v.id}:${v.style ?? "-"}`).join(" ")}</output>
    </>
  );
}

describe("a view's style in the properties panel", () => {
  it("starts as line art and changes from the Style list, taking projected views in the old style with it", async () => {
    render(<Harness view="f" />);
    const style = screen.getByRole("combobox", { name: "Style" });
    expect(style).toHaveValue("lineart");
    expect(screen.getByRole("option", { name: "Rendered" })).toBeInTheDocument();
    await userEvent.selectOptions(style, "Shaded");
    // The top view had the front's line art and follows; the right view's own wireframe stays; sections stay line art.
    expect(screen.getByTestId("styles")).toHaveTextContent("f:shaded t:shaded r:wireframe s:-");
    expect(screen.getByText("The bodies in their colours, under the edges you see.")).toBeInTheDocument();
    await userEvent.selectOptions(style, "Line art");
    expect(screen.getByTestId("styles")).toHaveTextContent("f:- t:- r:wireframe s:-");
  });

  it("says a section view is always line art, with no list", () => {
    render(<Harness view="s" />);
    expect(screen.queryByRole("combobox", { name: "Style" })).not.toBeInTheDocument();
    expect(screen.getByText("Section views are always drawn as line art.")).toBeInTheDocument();
  });
});

describe("view styles on the sheet", () => {
  it("asks the kernel for hidden edges for a wireframe, even with dashed hidden edges off", () => {
    expect(viewRequest(front).hidden).toBe(false);
    expect(viewRequest({ ...front, style: "wireframe" }).hidden).toBe(true);
    expect(viewRequest({ ...front, style: "wireframe" }, true).hidden).toBe(false);
  });

  it("gives a new projected view its parent's style, and it follows the parent while it keeps that style", () => {
    let s: DrawingSheet = { ...start, views: [{ ...front, style: "rendered" }] };
    s = placeProjected(s, "p", "f", [0, 1], "third", [150, 220]);
    expect(s.views.find((v) => v.id === "p")!.style).toBe("rendered");
    const before = s.views[0]!;
    s = followParent({ ...s, views: s.views.map((v) => (v.id === "f" ? { ...v, style: "shaded" as const } : v)) }, before);
    expect(s.views.find((v) => v.id === "p")!.style).toBe("shaded");
  });
});

describe("a shaded or rendered view on the sheet", () => {
  const plate: ModelView = {
    edges: [
      { curve: { kind: "line", a: [0, 0], b: [40, 20] }, visible: true, type: "sharp" },
      { curve: { kind: "line", a: [0, 20], b: [40, 0] }, visible: false, type: "sharp" },
    ],
    box: { min: [0, 0], max: [40, 20] },
    rounds: [],
    bodies: ["b1"],
    ms: 1,
  };
  const model: PictureModel = { meshes: new Map(), parts: [], built: { joints: [], drives: [], links: [], components: [] } };
  const paper = (style: DrawingView["style"], onSelectView = vi.fn()) => {
    const drawing: Drawing = { id: "dr", name: "Drawing 1", decimals: 2, sheets: [{ ...start, views: [{ ...front, hidden: true, style }] }] };
    const call = vi.fn<ViewCall>(() => Promise.resolve(plate));
    return render(<DrawingPaper drawing={drawing} onTitle={vi.fn()} doc={newDoc()} call={call} pictures={model} onSelectView={onSelectView} />);
  };
  const view = () => screen.getByRole("button", { name: /^Front view/ });

  // The pictures module (three.js and all) loads once, before the sheets ask for it.
  beforeAll(() => import("./pictures"), 20_000);

  it("draws the picture under the edges you see, and no hidden edges", async () => {
    const { container } = paper("shaded");
    await waitFor(() => expect(container.querySelector("image.bc-view-picture")).not.toBeNull());
    expect(container.querySelector("image.bc-view-picture")!.getAttribute("href")).toBe("data:image/jpeg;base64,shaded");
    expect(view().querySelector(".bc-view-visible")).not.toBeNull();
    expect(view().querySelector(".bc-view-hidden")).toBeNull();
  });

  it("shows a rendered view shaded first, then rendered, with no lines", async () => {
    const { container } = paper("rendered");
    await waitFor(() => expect(container.querySelector("image.bc-view-picture")?.getAttribute("href")).toBe("data:image/jpeg;base64,rendered"));
    expect(shot.mock.calls.map((c) => c[4])).toEqual(expect.arrayContaining(["shaded", "rendered"]));
    expect(view().querySelector("path")).toBeNull();
  });

  it("draws a wireframe's hidden edges solid, and says which view is selected", async () => {
    const onSelectView = vi.fn();
    const { container } = paper("wireframe", onSelectView);
    await waitFor(() => expect(view().querySelectorAll(".bc-view-visible")).toHaveLength(2));
    expect(container.querySelector("image")).toBeNull();
    act(() => view().focus());
    expect(onSelectView).toHaveBeenLastCalledWith("f");
  });
});
