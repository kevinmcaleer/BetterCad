import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ago, createAutosave, recoverable, type AutosaveRecord, type Discarded } from "./autosave";
import { memoryKV } from "./idb";

const rec = (id: string, over: Partial<AutosaveRecord> = {}) => ({ id, name: id, json: `{"${id}":1}`, savedAt: null, source: null, ...over });

describe("autosave (#84)", () => {
  let t = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  const make = (keep = 20) => {
    const kv = memoryKV<AutosaveRecord>();
    const bin = memoryKV<Discarded>();
    const a = createAutosave({ kv, bin, keep, now: () => t, idle: (fn) => fn() });
    return { a, kv, bin };
  };

  it("writes 3 seconds after the changes stop, with the latest change", async () => {
    const { a, kv } = make();
    const made = vi.fn((n: number) => rec("m1", { json: String(n) }));
    a.schedule(() => made(1));
    vi.advanceTimersByTime(2000);
    a.schedule(() => made(2));
    vi.advanceTimersByTime(2999);
    expect(await kv.get("m1")).toBeUndefined();
    vi.advanceTimersByTime(1);
    await a.list();
    expect((await kv.get("m1"))!.json).toBe("2");
    // Only the change that was written was serialised.
    expect(made).toHaveBeenCalledTimes(1);
  });

  it("flushes at once when the page is hidden or saved", async () => {
    const { a, kv } = make();
    a.schedule(() => rec("m1"));
    await a.flush();
    expect(await kv.get("m1")).toBeDefined();
    vi.advanceTimersByTime(5000);
    expect((await a.list()).length).toBe(1);
  });

  it("offers models never saved or changed since their save, not ones saved after", () => {
    const list: AutosaveRecord[] = [
      { ...rec("new"), modified: 10 },
      { ...rec("changed", { savedAt: 5 }), modified: 20 },
      { ...rec("saved", { savedAt: 30 }), modified: 30 },
      { ...rec("open"), modified: 40 },
    ];
    expect(recoverable(list, "open").map((r) => r.id)).toEqual(["changed", "new"]);
  });

  it("marks a model saved so it is not offered again", async () => {
    const { a } = make();
    a.schedule(() => rec("m1"));
    await a.flush();
    await a.markSaved("m1", t + 5, "m1.bcad");
    expect(recoverable(await a.list(), null)).toEqual([]);
  });

  it("keeps the last 20 models, dropping the oldest", async () => {
    const { a } = make(3);
    for (const id of ["a", "b", "c", "d"]) {
      t += 1000;
      a.schedule(() => rec(id));
      await a.flush();
    }
    expect((await a.list()).map((r) => r.id)).toEqual(["d", "c", "b"]);
  });

  it("keeps a discarded autosave a day in the bin", async () => {
    const { a, bin } = make();
    a.schedule(() => rec("m1"));
    await a.flush();
    await a.discard("m1");
    expect(await a.list()).toEqual([]);
    expect(await bin.get("m1")).toMatchObject({ id: "m1", discardedAt: t });
    t += 25 * 60 * 60 * 1000;
    a.schedule(() => rec("m2"));
    await a.flush();
    expect(await bin.get("m1")).toBeUndefined();
  });

  it("says how long ago", () => {
    expect(ago(10_000)).toBe("just now");
    expect(ago(120_000)).toBe("2 minutes ago");
    expect(ago(3_600_000)).toBe("1 hour ago");
    expect(ago(30 * 3_600_000)).toBe("yesterday");
  });
});
