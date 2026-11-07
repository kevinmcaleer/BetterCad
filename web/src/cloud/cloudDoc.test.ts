import { describe, expect, it } from "vitest";
import { createApi } from "./api";
import { fillBlobs, stripBlobs } from "./cloudDoc";
import { newDoc, type ModelDoc } from "../state/document";

describe("imported files in the cloud", () => {
  it("uploads each file once, stores the model without them, and fetches them back", async () => {
    const store = new Map<string, Uint8Array>();
    const puts: string[] = [];
    const api = createApi("api/", async (url, init) => {
      const hash = url.split("/").pop()!;
      if (init?.method === "HEAD") return new Response(null, { status: store.has(hash) ? 200 : 404 });
      if (init?.method === "PUT") {
        puts.push(hash);
        // jsdom's Blob has no arrayBuffer(); FileReader reads it.
        const bytes = await new Promise<ArrayBuffer>((ok) => {
          const r = new FileReader();
          r.onload = () => ok(r.result as ArrayBuffer);
          r.readAsArrayBuffer(init.body as Blob);
        });
        store.set(hash, new Uint8Array(bytes));
        return new Response(JSON.stringify({ hash, stored: true }), { headers: { "content-type": "application/json" } });
      }
      return new Response(store.get(hash) as BlobPart);
    });
    const doc: ModelDoc = {
      ...newDoc(),
      features: [
        { id: "f1", type: "import", name: "Import 1", file: "a.stl", blob: "b1234567890abcdef", format: "stl", bodies: [], position: [0, 0, 0] } as never,
      ],
      blobs: { b1234567890abcdef: btoa("solid x") },
    };
    const stripped = await stripBlobs(api, doc);
    expect(stripped.blobs).toEqual({ b1234567890abcdef: "" });
    await stripBlobs(api, doc);
    expect(puts).toEqual(["b1234567890abcdef"]);
    const filled = await fillBlobs(api, stripped);
    expect(atob(filled.blobs!.b1234567890abcdef!)).toBe("solid x");
    expect(await stripBlobs(api, newDoc())).toEqual(newDoc());
  });
});
