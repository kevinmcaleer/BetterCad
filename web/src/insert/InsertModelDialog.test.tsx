import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { saveBcad } from "@bettercad/kernel/bcad";
import { createApi } from "../cloud/api";
import { addPart, build, newDoc } from "../state/document";
import type { Placeable } from "../catalogue/usePlacePart";
import { InsertModelDialog } from "./InsertModelDialog";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const summary = (id: string, name: string) => ({ id, name, version: 4, created: "", modified: "", deleted_at: null, thumbnail: null });

function api() {
  const wheel = addPart(newDoc("Wheel"), "cylinder", "w");
  return createApi("api/", async (url) => {
    const u = new URL(url, "http://x/");
    if (u.pathname === "/api/models") {
      const q = u.searchParams.get("q");
      const all = [summary("m1", "Wheel"), summary("m2", "Chassis")];
      return json({ models: all.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())), total: 2 });
    }
    if (u.pathname === "/api/models/m1") return json({ ...summary("m1", "Wheel"), bcad: saveBcad(wheel), note: null });
    return json({});
  });
}

describe("Insert model picker (#484)", () => {
  it("lists your other models, and picking one makes it ready to place as one Insert model step", async () => {
    const picked: Placeable[] = [];
    render(<InsertModelDialog api={api()} signedIn current="m2" onPick={(m) => picked.push(m)} onCancel={() => undefined} />);
    const wheel = await screen.findByRole("button", { name: "Insert Wheel" });
    // The model open now can't go inside itself.
    expect(screen.queryByRole("button", { name: "Insert Chassis" })).toBeNull();
    fireEvent.click(wheel);
    await waitFor(() => expect(picked).toHaveLength(1));
    const p = picked[0]!;
    expect(p.name).toBe("Wheel");
    const d = p.put(newDoc(), { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, "ins", undefined);
    expect(d.features[0]).toMatchObject({ type: "model", source: { kind: "account", id: "m1", version: 4, name: "Wheel" } });
    expect(build(d).parts.map((x) => x.id)).toEqual(p.selects("ins"));
  });

  it("searches your models", async () => {
    render(<InsertModelDialog api={api()} signedIn onPick={() => undefined} onCancel={() => undefined} />);
    await screen.findByRole("button", { name: "Insert Chassis" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your models" }), { target: { value: "whe" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Insert Chassis" })).toBeNull());
    expect(screen.getByRole("button", { name: "Insert Wheel" })).toBeInTheDocument();
  });

  it("offers only files when signed out, and says why", () => {
    render(<InsertModelDialog api={api()} signedIn={false} onPick={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByText(/Sign in to insert models from My models/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /From a file/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your models" })).toBeNull();
  });
});
