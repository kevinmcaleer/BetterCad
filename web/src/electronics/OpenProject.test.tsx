import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { netlist, type ElectronicsDesign } from "@bettercad/electronics";
import { kicadProject } from "@bettercad/electronics/kicad/export";

import { sampleBoard } from "@bettercad/electronics/sample";
import OpenProject, { foundLine } from "./OpenProject";

vi.mock("./starter", () => ({ loadStarter: () => Promise.reject(new Error("offline")) }));

const files = () =>
  kicadProject(sampleBoard(), "servo")
    .files.filter((f) => /\.kicad_(sch|pcb|pro)$/.test(f.name))
    .map((f) => new File([f.text], f.name));

describe("opening a KiCad project", () => {
  it("says what was found in a sentence", () => {
    expect(foundLine({ sheets: 1, parts: 3, placed: 0, tracks: 0, vias: 0, pours: 0 })).toBe("Found 3 parts on 1 sheet, and no board.");
    expect(foundLine({ sheets: 2, parts: 9, placed: 8, tracks: 30, vias: 1, pours: 2 })).toBe(
      "Found 9 parts on 2 sheets, and a board with 8 parts placed, 30 tracks, 1 via and 2 pours.",
    );
  });

  it("reads the files, shows what came across, and hands over the design", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn<(d: ElectronicsDesign) => void>();
    render(<OpenProject replaces={false} onOpen={onOpen} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Open a KiCad project" });
    expect(within(dialog).getByRole("button", { name: "Open" })).toHaveAttribute("aria-disabled", "true");
    await user.upload(within(dialog).getByLabelText("Project files"), files());
    expect(await within(dialog).findByRole("status")).toHaveTextContent(/^Found \d+ parts on 1 sheet, and a board with \d+ parts placed/);
    await user.click(within(dialog).getByRole("button", { name: "Open" }));
    const opened = onOpen.mock.calls[0]![0];
    const pins = (d: ElectronicsDesign) =>
      netlist(d)
        .nets.map((n) =>
          n.pins
            .map((p) => `${p.ref}:${p.pin}`)
            .sort()
            .join(" "),
        )
        .sort();
    expect(pins(opened)).toEqual(pins(sampleBoard()));
    expect(opened.board?.tracks.length).toBeGreaterThan(0);
  });

  it("warns before it replaces a design, and says why a board alone will not open", async () => {
    const user = userEvent.setup();
    render(<OpenProject replaces onOpen={() => {}} onClose={() => {}} />);
    const all = files();
    await user.upload(
      screen.getByLabelText("Project files"),
      all.filter((f) => f.name.endsWith(".kicad_pcb")),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("A board needs its schematic. Add the project's .kicad_sch files too.");
    expect(screen.getByRole("button", { name: "Replace this design" })).toHaveAttribute("aria-disabled", "true");
    await user.upload(
      screen.getByLabelText("Project files"),
      all.filter((f) => f.name.endsWith(".kicad_sch")),
    );
    expect(await screen.findByText("This takes the place of the schematic and board you have now. Undo brings them back.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Replace this design" })).not.toHaveAttribute("aria-disabled");
  });
});
