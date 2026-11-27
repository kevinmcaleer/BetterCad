import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASICS, addWire, emptyDesign, placePart, pushToBoard, ratsnest, type ElectronicsDesign } from "@bettercad/electronics";
import { checkBoard } from "@bettercad/electronics/drc";
import { autoroute, type AutorouteOptions } from "@bettercad/electronics/pcb/autoroute";
import { setPlacement } from "@bettercad/electronics/pcb/route";
import { boardState } from "@bettercad/electronics/pcb/state";
import type { EEdit } from "./actions";
import AutoRoute from "./AutoRoute";
import { startRouting, type RouteEvents } from "./autorouteJob";
import { eui } from "./ui";

// A test can stand in for the router, to send the card events in an order of its own.
const fake = vi.hoisted(() => ({ run: null as null | ((design: ElectronicsDesign, on: RouteEvents) => void) }));

// jsdom has no workers: the card's router runs in the page here, a moment after it is asked.
vi.mock("./autorouteJob", async (real) => ({
  ...(await real<typeof import("./autorouteJob")>()),
  startRouting: (design: ElectronicsDesign, options: AutorouteOptions, on: RouteEvents, make?: () => Worker) => {
    if (make) return direct(design, options, on, make);
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      if (fake.run) return fake.run(design, on);
      autoroute(design, { ...options, onProgress: (p) => on.progress(p) });
      on.done();
    });
    return { stop: () => (live = false) };
  },
}));
const { startRouting: direct } = await vi.importActual<typeof import("./autorouteJob")>("./autorouteJob");

/** Two resistors on a board, joined pin to pin by two nets. */
function board(): { d: ElectronicsDesign; parts: [string, string] } {
  const a = placePart(emptyDesign(), "sh1", BASICS.resistor!(), { x: 0, y: 0 });
  const b = placePart(a.design, "sh1", BASICS.resistor!(), { x: 25.4, y: 0 });
  let d = b.design;
  const at = (part: string, pin: string): [number, number] => {
    const sym = d.sheets[0]!.symbols.find((y) => y.part === part)!;
    const p = d.defs[d.parts.find((x) => x.id === part)!.def]!.symbol.pins.find((x) => x.number === pin)!;
    return [sym.x + p.x, sym.y + p.y];
  };
  for (const [n, row] of [
    ["1", 15.24],
    ["2", -15.24],
  ] as const) {
    const from = at(a.part.id, n);
    const to = at(b.part.id, n);
    d = addWire(d, "sh1", from, [from[0], row]);
    d = addWire(d, "sh1", [from[0], row], [to[0], row]);
    d = addWire(d, "sh1", [to[0], row], to);
  }
  d = pushToBoard(d).design;
  d = setPlacement(d, a.part.id, { x: 12, y: 20 });
  d = setPlacement(d, b.part.id, { x: 32, y: 12 });
  return { d, parts: [a.part.id, b.part.id] };
}
const left = (d: ElectronicsDesign) => {
  const s = boardState(d);
  return ratsnest(s.pads, s.joined).length;
};

function setup(start: ElectronicsDesign) {
  let design = start;
  const labels: string[] = [];
  const view = () => <AutoRoute design={design} edit={edit} onClose={() => {}} />;
  const edit: EEdit = (change, label) => {
    design = change(design);
    labels.push(label);
    ui.rerender(view());
  };
  act(() => eui.set({ unrouted: left(start) }));
  const ui = render(view());
  return { labels, design: () => design };
}

afterEach(() => {
  fake.run = null;
  act(() => eui.reset());
});

describe("Autoroute (#647)", () => {
  it("routes what is left as one step, and says how it went", async () => {
    const { d } = board();
    expect(left(d)).toBe(2);
    const made = setup(d);
    expect(screen.getByText("2 connections still to route on the board.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Route" }));
    expect(await screen.findByText("Routed 2 of 2 connections. Undo takes the new tracks out in one step.")).toBeInTheDocument();
    expect(made.labels).toEqual(["Autoroute"]);
    expect(left(made.design())).toBe(0);
    expect(checkBoard(made.design())).toEqual([]);
  });

  it("lays the router's new set when it took routes up to make room (#754)", async () => {
    const { d } = board();
    const made = setup(d);
    fake.run = (design, on) => {
      const r = autoroute(design);
      const [first, second] = r.routes;
      on.progress({ done: 1, total: 2, routed: 1, failed: 0, net: first!.net, route: first! });
      on.progress({ done: 2, total: 2, routed: 1, failed: 1, net: second!.net });
      // It took the first up, made the second, and laid the first again.
      on.progress({ done: 2, total: 2, routed: 2, failed: 0, net: "", routes: [second!, first!], lost: [] });
      on.done();
    };
    await userEvent.click(screen.getByRole("button", { name: "Route" }));
    expect(await screen.findByText("Routed 2 of 2 connections. Undo takes the new tracks out in one step.")).toBeInTheDocument();
    expect(left(made.design())).toBe(0);
    expect(checkBoard(made.design())).toEqual([]);
  });

  it("routes only the picked part's connections, on one side when asked", async () => {
    const { d, parts } = board();
    const made = setup(d);
    act(() => eui.set({ selected: [parts[0]] }));
    await userEvent.selectOptions(screen.getByLabelText("What to route"), "The picked part");
    await userEvent.selectOptions(screen.getByLabelText("Sides to route on"), "Top only");
    await userEvent.click(screen.getByRole("button", { name: "Route" }));
    await screen.findByText(/^Routed 2 of 2 connections\./);
    expect(made.design().board!.tracks.every((t) => t.layer === "top")).toBe(true);
    expect(made.design().board!.vias).toEqual([]);
  });

  it("has nothing to do on a routed board", () => {
    const { d } = board();
    setup(d);
    act(() => eui.set({ unrouted: 0 }));
    expect(screen.getByText("Every connection on the board is routed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Route" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Clear routes" })).toHaveAttribute("aria-disabled", "true");
  });

  it("clears every track and via in one step, so it can route again", async () => {
    const { d } = board();
    const made = setup(d);
    await userEvent.click(screen.getByRole("button", { name: "Route" }));
    await screen.findByText(/^Routed 2 of 2 connections\./);
    expect(made.design().board!.tracks.length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Clear routes" }));
    expect(made.labels).toEqual(["Autoroute", "Clear routes"]);
    expect(made.design().board!.tracks).toEqual([]);
    expect(made.design().board!.vias).toEqual([]);
    expect(left(made.design())).toBe(2);
    expect(screen.getByText("Every track and via is off the board. Undo puts them back.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear routes" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the routing job", () => {
  it("passes on each route from its worker, and stops when told", () => {
    const made: { onmessage?: (ev: { data: unknown }) => void; postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[] = [];
    {
      const { d } = board();
      const seen: string[] = [];
      const on = { progress: (p: { net: string }) => seen.push(p.net), done: () => seen.push("done"), fail: () => seen.push("fail") };
      const make = () => {
        const w = { postMessage: vi.fn(), terminate: vi.fn() };
        made.push(w);
        return w as unknown as Worker;
      };
      const job = startRouting(d, { layers: ["top"] }, on, make);
      expect(made[0]!.postMessage).toHaveBeenCalledWith({ design: d, route: { layers: ["top"] } });
      made[0]!.onmessage!({ data: { progress: { done: 1, total: 2, routed: 1, failed: 0, net: "A" } } });
      job.stop();
      expect(made[0]!.terminate).toHaveBeenCalled();
      expect(seen).toEqual(["A"]);

      startRouting(d, {}, on, make);
      made[1]!.onmessage!({ data: { done: true } });
      startRouting(d, {}, on, make);
      made[2]!.onmessage!({ data: { error: "no" } });
      expect(seen).toEqual(["A", "done", "fail"]);
    }
  });
});
