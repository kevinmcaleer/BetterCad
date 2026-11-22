import { describe, expect, it } from "vitest";
import { writeStl } from "@bettercad/kernel/mesh-files";
import { loadBcad } from "@bettercad/kernel/bcad";
import { createApi } from "../cloud/api";
import { meshModel, uploadModels } from "./upload";

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
    expect(m.meshes[0]).toHaveLength(9);
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
    const said: string[] = [];
    const r = await uploadModels(api, [fileOf("Arm.stl", stl()), fileOf("readme.md", new Uint8Array(1))], { project_id: "rover" }, (t) => said.push(t));
    expect(r.made.map((m) => m.name)).toEqual(["Arm"]);
    expect(r.failed).toEqual(["readme.md isn't an STL or 3MF file."]);
    expect(said).toEqual(["Uploading Arm.stl (1 of 2)"]);
    expect(blobs).toHaveLength(1);
    expect(posts[0]).toMatchObject({ name: "Arm", project_id: "rover" });
    const saved = loadBcad(posts[0]!.bcad);
    if (saved instanceof Error) throw saved;
    // The bytes went up on their own; the saved model only names them.
    expect(Object.values(saved.doc.blobs ?? {})).toEqual([""]);
  });
});
