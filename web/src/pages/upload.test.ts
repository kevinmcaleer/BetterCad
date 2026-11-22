import { describe, expect, it } from "vitest";
import { writeStl } from "@bettercad/kernel/mesh-files";
import { loadBcad } from "@bettercad/kernel/bcad";
import { createApi } from "../cloud/api";
import { newDoc } from "../state/document";
import { bcadModel, meshModel, stepModel, uploadModels, type Engine, type UploadRow } from "./upload";
import { saveBcad } from "@bettercad/kernel/bcad";

/** One triangle, 10 mm on a side, as a binary STL. */
const stl = () => new Uint8Array(writeStl("t", [{ name: "t", triangles: Float32Array.of(0, 0, 0, 10, 0, 0, 0, 10, 0) }]));
const fileOf = (name: string, bytes: Uint8Array) => ({ name, arrayBuffer: async () => bytes.buffer }) as unknown as File;

describe("uploading STL files to My models", () => {
  it("makes a model holding the file as one Import step", () => {
    const m = meshModel("Bracket.stl", stl());
    expect(m.name).toBe("Bracket");
    expect(m.doc.name).toBe("Bracket");
    const [f] = m.doc.features as unknown as { type: string; format: string; file: string; blob: string; bodies: { name: string }[] }[];
    expect(f).toMatchObject({ type: "import", format: "stl", file: "Bracket.stl" });
    expect(f!.bodies.map((b) => b.name)).toEqual(["Bracket"]);
    expect(m.doc.blobs?.[f!.blob]).toBeTruthy();
    expect(m.picture.meshes[0]).toHaveLength(9);
  });

  it("refuses a file that isn't a mesh, or is damaged", () => {
    expect(() => meshModel("notes.txt", new Uint8Array(4))).toThrow("isn't an STL or 3MF file");
    expect(() => meshModel("broken.stl", new TextEncoder().encode("solid x\nendsolid x\n"))).toThrow("broken.stl: That STL file is damaged.");
  });

  it("uploads the file once, saves each model in the place on show, and names the ones it skipped", async () => {
    const posts: { name: string; project_id?: string; bcad: string }[] = [];
    const blobs: string[] = [];
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    const api = createApi("api/", async (url, init) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (init?.method === "PUT") {
        blobs.push(url);
        return json({ hash: "x", stored: true });
      }
      if (url === "api/models" && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        posts.push(body);
        return json({ id: `m${posts.length}`, name: body.name, version: 1, created: "", modified: "", deleted_at: null, thumbnail: null });
      }
      return new Response("{}", { status: 404 });
    });
    const said: UploadRow[][] = [];
    const r = await uploadModels(api, [fileOf("Arm.stl", stl()), fileOf("readme.md", new Uint8Array(1))], { project_id: "rover" }, (rows) => said.push(rows));
    expect(r.made.map((m) => m.name)).toEqual(["Arm"]);
    expect(r.failed).toEqual(["readme.md isn't a BetterCad, STL, 3MF or STEP file."]);
    // Each file's line goes from waiting, through its stages, to saved; the file it can't take fails at once.
    expect(said[0]).toEqual([
      { file: "Arm.stl", state: "waiting", stage: "Waiting" },
      { file: "readme.md", state: "failed", stage: "BetterCad takes .bcad, STL, 3MF and STEP files." },
    ]);
    expect([...new Set(said.map((rows) => rows[0]!.stage))]).toEqual(["Waiting", "Reading the file", "Uploading the file", "Saving the model", "Arm"]);
    expect(said.at(-1)![0]).toMatchObject({ state: "done", fraction: 1 });
    expect(blobs).toHaveLength(1);
    expect(posts[0]).toMatchObject({ name: "Arm", project_id: "rover" });
    const saved = loadBcad(posts[0]!.bcad);
    if (saved instanceof Error) throw saved;
    // The bytes went up on their own; the saved model only names them.
    expect(Object.values(saved.doc.blobs ?? {})).toEqual([""]);
  });

  it("reads a STEP file's bodies with the geometry engine", async () => {
    const asked: string[] = [];
    const engine = (async (method: string, params: { name: string }) => {
      asked.push(`${method} ${params.name}`);
      return {
        bodies: [
          { name: "Base", open: false },
          { name: "", open: false },
        ],
      };
    }) as unknown as Engine;
    const m = await stepModel("Gearbox.step", new TextEncoder().encode("ISO-10303-21;"), engine);
    expect(asked).toEqual(["inspect Gearbox.step"]);
    const [f] = m.doc.features as unknown as { format: string; bodies: { name: string }[] }[];
    expect(f!.format).toBe("step");
    expect(f!.bodies.map((b) => b.name)).toEqual(["Base", "Gearbox"]);
    expect(m.picture).toEqual({ doc: m.doc });
    const none = (async () => ({ bodies: [] })) as unknown as Engine;
    await expect(stepModel("Empty.stp", new Uint8Array(1), none)).rejects.toThrow("Empty.stp has no solids in it.");
    const bad = (async () => {
      throw new Error("That STEP file is damaged.");
    }) as unknown as Engine;
    await expect(stepModel("Bad.step", new Uint8Array(1), bad)).rejects.toThrow("Bad.step: That STEP file is damaged.");
  });

  it("says on the file's line why it failed: a damaged file, or a server that turned it away", async () => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    // A proxy in front of the server refusing the file answers with its own HTML page.
    const api = createApi("api/", async (_url, init) =>
      init?.method === "HEAD" ? new Response(null, { status: 404 }) : init?.method === "PUT" ? new Response("<html>blocked</html>", { status: 403 }) : json({}),
    );
    let last: UploadRow[] = [];
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const r = await uploadModels(
        api,
        [fileOf("broken.stl", new TextEncoder().encode("solid x\nendsolid x\n")), fileOf("Arm.stl", stl())],
        {},
        (rows) => (last = rows),
      );
      expect(r.made).toEqual([]);
      expect(last.map((x) => [x.state, x.stage])).toEqual([
        ["failed", "That STL file is damaged."],
        ["failed", "The server turned the file away (HTTP 403). Try again, or report a problem if it keeps happening."],
      ]);
      expect(r.failed[0]).toBe("broken.stl: That STL file is damaged.");
    } finally {
      console.error = quiet;
    }
  });

  it("shows a STEP file's engine start and read on its bar", async () => {
    const engine = (async (_m: string, _p: unknown, progress?: (phase: "starting" | "working", f: number) => void) => {
      progress?.("starting", 0.5);
      progress?.("working", 0.5);
      return { bodies: [{ name: "Horn", open: false }] };
    }) as unknown as Engine;
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    const api = createApi("api/", async (_url, init) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (init?.method === "PUT") return json({ hash: "x", stored: true });
      const body = JSON.parse(init!.body as string);
      return json({ id: "m1", name: body.name, version: 1, created: "", modified: "", deleted_at: null, thumbnail: null });
    });
    const seen: [string, number | undefined][] = [];
    await uploadModels(
      api,
      [fileOf("Servo.step", new TextEncoder().encode("ISO-10303-21;"))],
      { project_id: "duck" },
      (rows) => seen.push([rows[0]!.stage, rows[0]!.fraction]),
      engine,
    );
    const at = (stage: string) => seen.find(([s]) => s === stage)?.[1];
    expect(at("Starting the geometry engine")).toBeCloseTo(0.225);
    expect(at("Finding the solids")).toBeCloseTo(0.6);
    expect(seen.at(-1)).toEqual(["Servo", 1]);
  });

  it("takes a .bcad as it was saved, with its own picture", () => {
    const text = saveBcad(newDoc("Rover chassis"), { thumbnail: "data:image/png;base64,AAAA" });
    const m = bcadModel("chassis.bcad", text);
    expect(m.name).toBe("Rover chassis");
    expect(m.thumbnail).toBe("data:image/png;base64,AAAA");
    expect(m.picture).toBeNull();
    expect(bcadModel("bare.bcad", saveBcad(newDoc("Bare"))).picture).toEqual({ doc: expect.objectContaining({ name: "Bare" }) });
    expect(() => bcadModel("junk.bcad", "{")).toThrow("junk.bcad: That file is not a BetterCad model");
  });
});
