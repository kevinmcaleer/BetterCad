import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { newDoc, type Part } from "../state/document";
import type { FileStore } from "../files/fileStore";
import { ExportDialog } from "./ExportDialog";

const parts = [
  { id: "a", name: "Wheel" },
  { id: "b", name: "Axle" },
] as Part[];

const setup = (bodies?: string[]) => {
  const estimate = { solids: 1, triangles: 1200, bytes: 60_000, skipped: 0 };
  const call = vi.fn((method: string) => {
    const v = method === "estimate" ? estimate : { files: [{ name: "Wheel.stl", bytes: new Uint8Array([1]) }] };
    return Object.assign(Promise.resolve(v), { cancel: vi.fn() });
  });
  const files = { saveFiles: vi.fn(async (f: { name: string }[]) => ({ names: f.map((x) => x.name) })) } as unknown as FileStore;
  render(
    <ExportDialog
      open
      onClose={vi.fn()}
      doc={{ ...newDoc(), name: "Rover" }}
      upTo={0}
      parts={parts}
      selection={[]}
      call={call as never}
      files={files}
      say={vi.fn()}
      onGroup={vi.fn()}
      bodies={bodies}
    />,
  );
  return { call };
};

describe("ExportDialog for one body", () => {
  it("exports only that body, named after it", async () => {
    const { call } = setup(["a"]);
    expect(screen.getByRole("dialog", { name: "Export Wheel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "URDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "All bodies" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "3MF" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/triangles/));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("export", expect.objectContaining({ bodies: ["a"], format: "3mf", name: "Wheel" })));
  });

  it("offers one file or one each for several bodies", async () => {
    const { call } = setup(["a", "b"]);
    expect(screen.getByRole("dialog", { name: "Export 2 bodies" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Each on its own" }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith("estimate", expect.objectContaining({ bodies: ["a", "b"], separate: true })));
  });

  it("keeps the whole-model choices for the model's own export", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Export" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "URDF" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All bodies" })).toBeTruthy();
  });
});
