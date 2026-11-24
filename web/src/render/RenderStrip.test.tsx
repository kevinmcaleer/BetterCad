import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RenderShot } from "@bettercad/kernel/document";
import { memoryKV } from "../files/idb";
import { RenderJobs, type RenderFn } from "./jobs";
import { RenderStrip, RenderWheel } from "./RenderStrip";
import type { RenderBody } from "./pathRender";

const shot = (id: string, name: string, auto = true): RenderShot => ({
  id,
  name,
  camera: { target: [0, 0, 0], azimuth: 45, elevation: 30, distance: 100, ortho: false },
  preset: "studio",
  style: "finishes",
  background: "lightbox",
  focus: "soft",
  quality: "good",
  width: 160,
  height: 90,
  auto,
});
const never: RenderFn = (_s, _b, progress) => {
  progress(0.4);
  return new Promise(() => {});
};
const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));
URL.createObjectURL ??= () => "blob:x";
URL.revokeObjectURL ??= () => {};

function strip(jobs: RenderJobs, shots: RenderShot[], o: Partial<Parameters<typeof RenderStrip>[0]> = {}) {
  const props = {
    jobs,
    shots,
    keyOf: () => "now",
    onAdd: vi.fn(),
    onRerender: vi.fn(),
    onUse: vi.fn(),
    onChange: vi.fn(),
    onDelete: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
  render(<RenderStrip {...props} />);
  return props;
}

describe("RenderStrip", () => {
  it("shows each shot, how far a running one has got, and one that is out of date", async () => {
    const store = memoryKV<{ key: string; blob: Blob; date: number }>();
    await store.set("old", { key: "before", blob: new Blob(["x"]), date: 1 });
    const jobs = new RenderJobs({ store, render: never });
    await jobs.load([shot("old", "Front")]);
    jobs.enqueue(shot("run", "Top"), "now", [{} as RenderBody]);
    await tick();
    const p = strip(jobs, [shot("old", "Front"), shot("run", "Top"), shot("new", "Side")]);
    expect(screen.getByRole("button", { name: "Front, out of date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Top, rendering, 40%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Side, not rendered yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to strip" }));
    expect(p.onAdd).toHaveBeenCalled();
    jobs.dispose();
  });

  it("opens a render with Save image, Render again, Use this view and its save switch", async () => {
    const store = memoryKV<{ key: string; blob: Blob; date: number }>();
    await store.set("a", { key: "now", blob: new Blob(["x"]), date: 1 });
    const jobs = new RenderJobs({ store, render: never });
    await jobs.load([shot("a", "Front")]);
    const s = shot("a", "Front");
    const p = strip(jobs, [s]);
    fireEvent.click(screen.getByRole("button", { name: "Front" }));
    const dialog = screen.getByRole("dialog", { name: "Front" });
    expect(dialog).toContainElement(screen.getByRole("img", { name: "Render of Front" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Update when I save" }));
    expect(p.onChange).toHaveBeenCalledWith({ ...s, auto: false });
    fireEvent.click(screen.getByRole("button", { name: "Save image" }));
    expect(p.onSave).toHaveBeenCalledWith(s);
    fireEvent.click(screen.getByRole("button", { name: "Render again" }));
    expect(p.onRerender).toHaveBeenCalledWith(s);
    fireEvent.click(screen.getByRole("button", { name: "Use this view" }));
    expect(p.onUse).toHaveBeenCalledWith(s);
    jobs.dispose();
  });

  it("only lets you look at a shared model's renders", async () => {
    const jobs = new RenderJobs({ store: memoryKV(), render: never });
    strip(jobs, [shot("a", "Front")], { readOnly: true });
    expect(screen.queryByRole("button", { name: "Add to strip" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Front, not rendered yet" }));
    expect(screen.queryByRole("button", { name: "Render again" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Update when I save" })).toBeNull();
    jobs.dispose();
  });
});

describe("RenderWheel", () => {
  it("shows how far the background renders have got, and goes when they are done", async () => {
    let finish = () => {};
    const jobs = new RenderJobs({
      store: memoryKV(),
      render: (_s, _b, progress) => {
        progress(0.5);
        return new Promise((r) => (finish = () => r(new Blob(["x"]))));
      },
    });
    const onOpen = vi.fn();
    render(<RenderWheel jobs={jobs} onOpen={onOpen} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    act(() => jobs.enqueue(shot("a", "Front"), "k", [{} as RenderBody]));
    await tick();
    expect(screen.getByRole("progressbar", { name: "Background renders" })).toHaveAttribute("aria-valuenow", "50");
    fireEvent.click(screen.getByRole("button", { name: "Renders in the background, 50% done" }));
    expect(onOpen).toHaveBeenCalled();
    await act(async () => finish());
    await tick();
    await tick();
    expect(screen.queryByRole("progressbar")).toBeNull();
    jobs.dispose();
  });
});
