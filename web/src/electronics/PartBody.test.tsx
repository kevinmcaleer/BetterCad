import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComponentDef } from "@bettercad/electronics";
import { saveBcad } from "@bettercad/kernel/bcad";
import { newDoc } from "@bettercad/kernel/document";
import type { KernelCall } from "./bodyFile";
import { PartEditor, type PartEditorProps } from "./PartTools";
import { build, newDraft } from "./partDraft";

/** The pads of the part the editor starts with. */
const PADS = build(newDraft()).footprint!.pads;

/** A flat foot under each pad, all of them 0.5 mm right and 0.3 mm down of where they belong. */
function feet() {
  const positions: number[] = [];
  const indices: number[] = [];
  PADS.forEach((pad, i) => {
    const [x, y] = [pad.x + 0.5, pad.y - 0.3];
    positions.push(x - 0.2, y - 0.2, 1.6, x + 0.2, y - 0.2, 1.6, x + 0.2, y + 0.2, 1.6, x - 0.2, y + 0.2, 1.6);
    indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), edgePositions: new Float32Array(0) };
}

/**
 * A geometry engine that finds two solids in a 10 by 4 by 6 mm box in any STEP file, writes any model out as STEP,
 * and builds a body whose feet are a little off the pads.
 */
const engine = () => {
  const seen: { method: string; params: unknown }[] = [];
  const call = ((method: string, params: unknown) => {
    seen.push({ method, params });
    if (method === "inspect")
      return Promise.resolve({
        bodies: [
          { name: "Case", open: false },
          { name: "Pins", open: false },
        ],
        size: [10, 4, 6],
      });
    if (method === "export") return Promise.resolve({ files: [{ name: "model.step", data: new TextEncoder().encode("ISO-10303-21;").buffer }] });
    if (method === "build")
      return Object.assign(
        Promise.resolve({
          bodies: [
            { id: "fpreview/board", mesh: feet() },
            { id: "fpreview/pt1", mesh: feet() },
          ],
          failed: [],
        }),
        { cancel: () => undefined },
      );
    return null;
  }) as unknown as KernelCall;
  return { call, seen };
};

async function openBody(call?: KernelCall, models?: PartEditorProps["models"]) {
  const onSave = vi.fn<(def: ComponentDef, shelf: string, id?: string, files?: Record<string, string>) => void>();
  render(<PartEditor start={{}} shelves={[]} onSave={onSave} onCancel={() => {}} {...(call ? { call } : {})} {...(models ? { models } : {})} />);
  const editor = screen.getByRole("dialog", { name: "New part" });
  await userEvent.type(within(editor).getByLabelText("Name"), "Relay");
  await userEvent.click(within(editor).getByRole("tab", { name: "3D body" }));
  await userEvent.selectOptions(within(editor).getByLabelText("Body"), "A STEP file or a BetterCad model");
  return { editor: within(editor), onSave };
}

describe("a part's body from a file (#628)", () => {
  it("reads a STEP file, sits it on the pads, and saves the part with the file", async () => {
    const { call, seen } = engine();
    const { editor, onSave } = await openBody(call);
    expect(editor.getByRole("list", { name: "Checks" })).toHaveTextContent("Pick a file for the body.");
    await userEvent.upload(editor.getByLabelText("File"), new File(["ISO-10303-21;"], "relay.step"));
    expect(await editor.findByText("relay.step: 2 solids, 10 × 4 × 6 mm.")).toBeInTheDocument();
    expect(seen[0]).toMatchObject({ method: "inspect", params: { name: "relay.step", format: "step" } });
    expect(editor.getByRole("img", { name: /^Footprint/ }).closest("figure")).toHaveTextContent("Footprint and body");

    // Tipped onto its back it would sink into the board: Sit it on the board lifts it clear.
    const turn = editor.getByLabelText("Turn about X (°)");
    await userEvent.clear(turn);
    await userEvent.type(turn, "90{Enter}");
    await userEvent.click(editor.getByRole("button", { name: "Sit it on the board" }));
    expect(editor.getByLabelText("Lift (mm)")).toHaveValue("2");

    await userEvent.click(screen.getByRole("button", { name: "Save to your parts" }));
    const [def, , , files] = onSave.mock.calls[0]!;
    const model = def.packages[0]!.model!;
    expect(model).toMatchObject({ source: { kind: "step", name: "relay.step", bodies: 2, size: [10, 4, 6] }, offset: [0, 0, 2], rotate: [90, 0, 0] });
    const blob = (model.source as { blob: string }).blob;
    expect(Object.keys(files!)).toEqual([blob]);
    expect(atob(files![blob]!)).toBe("ISO-10303-21;");
  });

  it("says why when the file is the wrong kind or the geometry engine is off", async () => {
    const { editor } = await openBody(engine().call);
    await userEvent.upload(editor.getByLabelText("File"), new File(["solid"], "relay.stl"), { applyAccept: false });
    expect(await editor.findByRole("alert")).toHaveTextContent("Pick a STEP file (.step or .stp) or a BetterCad model (.bcad).");
  });

  it("says the geometry engine is off when it is", async () => {
    const { editor } = await openBody();
    await userEvent.upload(editor.getByLabelText("File"), new File(["ISO-10303-21;"], "relay.step"));
    expect(await editor.findByRole("alert")).toHaveTextContent("The geometry engine is off, so the file can't be read.");
  });

  it("shows the body on its footprint in 3D, and snaps its pins to the pads", async () => {
    const { call } = engine();
    const { editor } = await openBody(call);
    expect(editor.getByRole("img", { name: /^The body on its footprint, in 3D/ })).toBeInTheDocument();
    await userEvent.upload(editor.getByLabelText("File"), new File(["ISO-10303-21;"], "relay.step"));
    await editor.findByText("relay.step: 2 solids, 10 × 4 × 6 mm.");
    const snap = editor.getByRole("button", { name: "Snap its pins to the pads" });
    await waitFor(() => expect(snap).not.toHaveAttribute("aria-disabled"));
    const [x, y] = [Number((editor.getByLabelText("X (mm)") as HTMLInputElement).value), Number((editor.getByLabelText("Y (mm)") as HTMLInputElement).value)];
    await userEvent.click(snap);
    expect(editor.getByText(`Moved it 0.58 mm. ${PADS.length} of its ${PADS.length} pin ends sit on pads.`)).toBeInTheDocument();
    expect(Number((editor.getByLabelText("X (mm)") as HTMLInputElement).value)).toBeCloseTo(x - 0.5, 3);
    expect(Number((editor.getByLabelText("Y (mm)") as HTMLInputElement).value)).toBeCloseTo(y + 0.3, 3);
  });

  it("takes one of your models, or a robot catalogue part, as the body", async () => {
    const { call, seen } = engine();
    const models = {
      list: vi.fn(() => Promise.resolve({ models: [{ id: "m1", name: "Relay case", deleted_at: null }] })),
      get: vi.fn(() => Promise.resolve({ name: "Relay case", version: 1, bcad: saveBcad(newDoc("Relay case")) })),
      getBlob: vi.fn(),
    } as unknown as NonNullable<PartEditorProps["models"]>;
    const { editor } = await openBody(call, models);
    await userEvent.selectOptions(await editor.findByLabelText("Or one of your models"), "Relay case");
    expect(await editor.findByText("Relay case: 2 solids, 10 × 4 × 6 mm.")).toBeInTheDocument();
    expect(seen.find((c) => c.method === "export")).toMatchObject({ params: { format: "step", doc: { name: "Relay case" } } });

    seen.length = 0;
    await userEvent.selectOptions(await editor.findByLabelText("Or a robot catalogue part"), "SG90 micro servo");
    expect(await editor.findByText("SG90 micro servo: 2 solids, 10 × 4 × 6 mm.")).toBeInTheDocument();
    // It goes out as an ordinary body: a reference body would not be exported.
    expect(seen.find((c) => c.method === "export")).toMatchObject({
      params: { doc: { features: [{ type: "insert" }], looks: { pcat: { reference: false } } } },
    });
  });
});
