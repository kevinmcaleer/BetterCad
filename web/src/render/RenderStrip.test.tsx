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

  it("shows a waiting shot's first look, and moves shots by drag or menu", async () => {
    const jobs = new RenderJobs({ store: memoryKV(), render: never });
    await jobs.seed("b", new Blob(["look"]));
    const onMove = vi.fn();
    strip(jobs, [shot("a", "Front"), shot("b", "Top")], { onMove });
    const top = screen.getByRole("button", { name: "Top, not rendered yet" });
    expect(top.querySelector("img[data-first]")).not.toBeNull();
    const data = { setData: () => {}, effectAllowed: "" };
    fireEvent.dragStart(top.closest("li")!, { dataTransfer: data });
    const front = screen.getByRole("button", { name: "Front, not rendered yet" }).closest("li")!;
    fireEvent.dragOver(front, { dataTransfer: data });
    fireEvent.drop(front, { dataTransfer: data });
    expect(onMove).toHaveBeenCalledWith("b", 0);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Front, not rendered yet" }));
    expect(screen.getByRole("menuitem", { name: "Move earlier" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move later" }));
    expect(onMove).toHaveBeenCalledWith("a", 1);
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

  it("shows a running render's picture so far on its tile", async () => {
    let send: ((b: Blob) => void) | undefined;
    const jobs = new RenderJobs({
      store: memoryKV(),
      render: (_s, _b, progress, _w, _sig, preview) => {
        progress(0.5);
        send = preview;
        return new Promise(() => {});
      },
    });
    jobs.enqueue(shot("a", "Front"), "k", [{} as RenderBody]);
    await tick();
    strip(jobs, [shot("a", "Front")]);
    const tile = screen.getByRole("button", { name: "Front, rendering, 50%" });
    expect(tile.querySelector("img[data-preview]")).toBeNull();
    act(() => send!(new Blob(["x"])));
    expect(tile.querySelector("img[data-preview]")).not.toBeNull();
    jobs.dispose();
  });
});

describe("animations on the strip", () => {
  it("shows a clip with its length, and plays it or saves its video from the tile or the viewer", async () => {
    const store = memoryKV<{ key: string; blob: Blob; date: number }>();
    await store.set("c", { key: "now", blob: new Blob(["x"]), date: 1 });
    const jobs = new RenderJobs({ store, render: never });
    const clip: RenderShot = { ...shot("c", "Draw on and orbit"), animation: { drawOn: { colour: "blue" }, move: "orbit", length: "normal" } };
    await jobs.load([clip]);
    const onRecord = vi.fn();
    const p = strip(jobs, [clip], { onRecord });
    const tile = screen.getByRole("button", { name: "Draw on and orbit, animation, 10 s" });
    expect(tile).toHaveTextContent("10 s");
    fireEvent.contextMenu(tile);
    expect(screen.queryByRole("menuitem", { name: "Use this view" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Play" }));
    expect(p.onUse).toHaveBeenCalledWith(clip);
    fireEvent.contextMenu(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Save video" }));
    expect(onRecord).toHaveBeenCalledWith(clip);
    fireEvent.contextMenu(tile);
    fireEvent.click(screen.getByRole("menuitem", { name: "Save poster" }));
    expect(p.onSave).toHaveBeenCalledWith(clip);
    fireEvent.click(tile);
    const dialog = screen.getByRole("dialog", { name: "Draw on and orbit" });
    expect(dialog).toHaveTextContent("Animation, 10 s.");
    fireEvent.click(screen.getByRole("button", { name: "Save video" }));
    expect(onRecord).toHaveBeenCalledTimes(2);
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
