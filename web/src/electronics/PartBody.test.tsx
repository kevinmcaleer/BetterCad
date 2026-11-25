import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComponentDef } from "@bettercad/electronics";
import type { KernelCall } from "./bodyFile";
import { PartEditor } from "./PartTools";

/** A geometry engine that finds two solids in a 10 by 4 by 6 mm box in any STEP file. */
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
    return null;
  }) as unknown as KernelCall;
  return { call, seen };
};

async function openBody(call?: KernelCall) {
  const onSave = vi.fn<(def: ComponentDef, shelf: string, id?: string, files?: Record<string, string>) => void>();
  render(<PartEditor start={{}} shelves={[]} onSave={onSave} onCancel={() => {}} {...(call ? { call } : {})} />);
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
});
