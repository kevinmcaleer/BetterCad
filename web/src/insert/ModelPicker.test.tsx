import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { saveBcad } from "@bettercad/kernel/bcad";
import { createApi } from "../cloud/api";
import { addPart, newDoc } from "../state/document";
import type { Placeable } from "../catalogue/usePlacePart";
import { ModelPicker } from "./ModelPicker";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const summary = (id: string, name: string, project_id: string | null = null) => ({
  id,
  name,
  version: 3,
  created: "",
  modified: "",
  deleted_at: null,
  thumbnail: null,
  folder_id: null,
  project_id,
});

function api() {
  const wheel = addPart(newDoc("Wheel"), "cylinder", "w");
  return createApi("api/", async (url) => {
    const u = new URL(url, "http://x/");
    if (u.pathname === "/api/places")
      return json({ folders: [], projects: [{ id: "p1", name: "Rover", readme: "", cover: null, created: "", modified: "", deleted_at: null, models: 1 }] });
    if (u.pathname === "/api/models") return json({ models: [summary("m1", "Wheel", "p1"), summary("m2", "Chassis")], total: 2 });
    if (u.pathname === "/api/models/m1") return json({ ...summary("m1", "Wheel", "p1"), bcad: saveBcad(wheel), note: null });
    return json({});
  });
}

describe("Model picker panel (#480)", () => {
  it("lists projects and models, and right-click inserts one as a linked component", async () => {
    const picked: Placeable[] = [];
    render(<ModelPicker api={api()} signedIn current="m2" onInsert={(m) => picked.push(m)} onClose={() => undefined} />);
    const tree = await screen.findByRole("tree", { name: "Your models" });
    // Projects start folded: open Rover to see its model.
    fireEvent.click(within(tree).getByRole("button", { name: "Show what is in Rover" }));
    const wheel = within(tree).getByRole("button", { name: "Wheel" });
    fireEvent.contextMenu(wheel);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Insert as a linked component/ }));
    await waitFor(() => expect(picked).toHaveLength(1));
    const d = picked[0]!.put(newDoc(), { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, "ins", undefined);
    expect(d.features[0]).toMatchObject({ type: "model", source: { kind: "account", id: "m1", version: 3, name: "Wheel" } });
  });

  it("won't insert the open model into itself", async () => {
    render(<ModelPicker api={api()} signedIn current="m2" onInsert={() => undefined} onClose={() => undefined} />);
    const chassis = await screen.findByRole("button", { name: /Chassis/ });
    fireEvent.contextMenu(chassis);
    expect(await screen.findByRole("menuitem", { name: /can't go inside itself/ })).toBeDisabled();
  });

  it("asks you to sign in when signed out", () => {
    render(<ModelPicker api={api()} signedIn={false} onInsert={() => undefined} onClose={() => undefined} />);
    expect(screen.getByText(/Sign in to see your projects and models/)).toBeInTheDocument();
  });
});
