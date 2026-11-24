import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApi } from "../cloud/api";
import { addJoint, addLink, addPart, build, insertedId, newDoc, type ModelDoc } from "../state/document";
import { MakeExternalDialog, freeName } from "./MakeExternalDialog";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const summary = (id: string, name: string, extra = {}) => ({ id, name, version: 1, created: "", modified: "", deleted_at: null, thumbnail: null, ...extra });

/** A plate, and a Wheel component jointed to it. */
function rover(): ModelDoc {
  let d = addPart(newDoc("Rover"), "box", "plate");
  d = addLink(d, ["plate"], "base", undefined, undefined, "Base");
  d = addPart(d, "cylinder", "tyre");
  d = addLink(d, ["tyre"], "wheel", undefined, undefined, "Wheel");
  return addJoint(d, { kind: "continuous", child: "wheel", parent: "base", origin: [0, 0, 0], axis: [0, 1, 0], lower: 0, upper: 0 }, "spin");
}

function setup(o: { signedIn?: boolean; others?: string[] } = {}) {
  let doc = rover();
  const store = { get: () => doc, edit: (fn: (d: ModelDoc) => ModelDoc) => void (doc = fn(doc)) };
  const made: unknown[] = [];
  const api = createApi("api/", async (url, init) => {
    const u = new URL(url, "http://x/");
    if (u.pathname === "/api/models/open" && init?.method === "GET")
      return json({ ...summary("open", "Rover", { folder_id: "f1", project_id: "p1" }), bcad: "", note: null });
    if (u.pathname === "/api/places") return json({ folders: [{ id: "f1", name: "Wheels", project_id: "p1" }], projects: [{ id: "p1", name: "Rover build" }] });
    if (u.pathname === "/api/models" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { name: string; folder_id: string };
      made.push(body);
      return json(summary("new1", body.name));
    }
    if (u.pathname === "/api/models") {
      expect(u.searchParams.get("folder")).toBe("f1");
      return json({ models: (o.others ?? ["Wheel"]).map((n, i) => summary(`m${i}`, n)), total: 1 });
    }
    return json({});
  });
  const said: string[] = [];
  const saveAs = vi.fn(async () => ({ name: "Wheel", inPlace: false }) as never);
  const closed = vi.fn();
  render(
    <MakeExternalDialog
      api={api}
      id="wheel"
      store={store}
      signedIn={o.signedIn ?? true}
      signinUrl="#/signin"
      modelId="open"
      files={{ saveAs }}
      say={(t) => said.push(t)}
      onClose={closed}
    />,
  );
  return { doc: () => doc, made, said, saveAs, closed };
}

describe("Make external", () => {
  it("names it so it doesn't clash with a model beside this one", () => {
    expect(freeName("Wheel", ["wheel", "Wheel 2"])).toBe("Wheel 3");
    expect(freeName("Wheel", [])).toBe("Wheel");
  });

  it("saves the component beside this model and links it back in, joint kept", async () => {
    const t = setup();
    const name = screen.getByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name).toHaveValue("Wheel 2"));
    expect(screen.getByText(/in Wheels in Rover build/)).toBeInTheDocument();
    // A name already taken there can't be saved.
    fireEvent.change(name, { target: { value: "wheel" } });
    expect(screen.getByRole("alert")).toHaveTextContent("A model called wheel is already there");
    expect(screen.getByRole("button", { name: /Save and link/ })).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(name, { target: { value: "Front wheel" } });
    fireEvent.click(screen.getByRole("button", { name: /Save and link/ }));
    await waitFor(() => expect(t.closed).toHaveBeenCalled());
    expect(t.made).toMatchObject([{ name: "Front wheel", folder_id: "f1", project_id: "p1" }]);
    const step = t.doc().features.find((f) => f.id === "wheel");
    expect(step).toMatchObject({ type: "model", name: "Wheel", source: { kind: "account", id: "new1", version: 1, name: "Front wheel" } });
    const b = build(t.doc());
    expect(b.parts.map((p) => p.id)).toContain(insertedId("wheel", "tyre"));
    expect(b.joints.map((j) => j.child)).toEqual(["wheel"]);
    expect(t.said[0]).toMatch(/Saved Front wheel to Wheels in Rover build/);
  });

  it("signed out, saves it as a file and links that", async () => {
    const t = setup({ signedIn: false });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "#/signin");
    fireEvent.click(screen.getByRole("button", { name: /Save as a file/ }));
    await waitFor(() => expect(t.closed).toHaveBeenCalled());
    expect(t.saveAs).toHaveBeenCalledWith(expect.stringContaining('"bettercad"'), "Wheel");
    expect(t.doc().features.find((f) => f.id === "wheel")).toMatchObject({ type: "model", source: { kind: "file", name: "Wheel" } });
  });
});
