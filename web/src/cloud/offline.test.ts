import { describe, expect, it } from "vitest";
import { memoryKV } from "../files/idb";
import { createApi } from "./api";
import { createOffline, type Queued } from "./offline";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const q = (modelId: string, at: number, version = 1): Queued => ({ modelId, name: modelId, bcad: "{}", version, at });

describe("the offline queue", () => {
  it("keeps the newest save per model and sends them in order when back", async () => {
    const o = createOffline(memoryKV(), memoryKV());
    await o.queue(q("a", 1));
    await o.queue(q("b", 2));
    await o.queue({ ...q("a", 3), bcad: '{"newer":1}' });
    expect((await o.queued()).map((x) => x.modelId)).toEqual(["b", "a"]);
    const sent: string[] = [];
    const api = createApi("api/", async (url, init) => {
      sent.push(`${url} ${init?.body}`);
      return url.endsWith("/b") ? json(409, { detail: { message: "This model changed in another tab.", version: 3 } }) : json(200, { version: 2 });
    });
    const r = await o.flush(api);
    expect(r.saved).toEqual([{ modelId: "a", version: 2 }]);
    expect(r.conflicts.map((x) => x.modelId)).toEqual(["b"]);
    expect(sent.some((s) => s.includes("newer"))).toBe(true);
    expect(await o.queued()).toEqual([]);
  });

  it("stops at the first network failure and keeps the rest", async () => {
    const o = createOffline(memoryKV(), memoryKV());
    await o.queue(q("a", 1));
    const r = await o.flush(
      createApi("api/", async () => {
        throw new TypeError("offline");
      }),
    );
    expect(r.saved).toEqual([]);
    expect((await o.queued()).length).toBe(1);
  });

  it("remembers the list and the last ten models", async () => {
    const o = createOffline(memoryKV(), memoryKV());
    await o.rememberList([]);
    expect(await o.lastList()).toEqual([]);
    for (let i = 0; i < 12; i++) {
      await o.rememberModel({ id: `m${i}`, name: "x", version: 1, created: "", modified: "", deleted_at: null, thumbnail: null, bcad: "{}", note: null });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(await o.lastModel("m0")).toBeNull();
    expect((await o.lastModel("m11"))?.id).toBe("m11");
  });
});
