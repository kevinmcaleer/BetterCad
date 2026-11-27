import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASICS, emptyPack, putPart } from "@bettercad/electronics";
import type { OwnBlock } from "@bettercad/electronics/ownBlocks";
import { MY_PARTS, loadLocal, merge, readLibrary, useMyLibrary } from "./myLibrary";

const mine = (name: string) => ({ ...BASICS.resistor!(), name, source: { library: "You", licence: "CC0 1.0" } });
afterEach(() => localStorage.clear());

describe("your parts", () => {
  it("keeps what you save in this browser, and forgets what you delete", () => {
    const { result } = renderHook(() => useMyLibrary());
    let id = "";
    act(() => void (id = result.current.save(mine("Shunt"), "")));
    expect(id).toBe("shunt");
    expect(result.current.pack.parts.map((p) => [p.id, p.name, p.category])).toEqual([["shunt", "Shunt", MY_PARTS]]);
    expect(loadLocal().pack.parts.map((p) => p.id)).toEqual(["shunt"]);
    act(() => void result.current.save(mine("Shunt 2"), "Passives", "shunt"));
    expect(result.current.pack.parts.map((p) => [p.id, p.name, p.category])).toEqual([["shunt", "Shunt 2", "Passives"]]);
    act(() => result.current.remove("shunt"));
    expect(result.current.pack.parts).toEqual([]);
    expect(loadLocal().removed).toEqual(["shunt"]);
  });

  it("merges with the account when you are signed in, and sends up what the account lacks", async () => {
    const remote = { pack: putPart(emptyPack(MY_PARTS), "theirs", mine("Theirs"), MY_PARTS), removed: ["gone"] };
    localStorage.setItem(
      "bettercad.electronics.library",
      JSON.stringify({ pack: putPart(putPart(emptyPack(MY_PARTS), "local", mine("Local"), MY_PARTS), "gone", mine("Gone"), MY_PARTS), removed: [] }),
    );
    const call = vi.fn((method: string) => Promise.resolve(method === "GET" ? { ...remote, modified: "now" } : { ok: true }));
    const api = { call } as never;
    const { result } = renderHook(() => useMyLibrary(api, true));
    await waitFor(() => expect(result.current.pack.parts.map((p) => p.id)).toEqual(["local", "theirs"]));
    const put = call.mock.calls.find((c) => c[0] === "PUT") as unknown as [string, string, { pack: { parts: { id: string }[] }; removed: string[] }];
    expect(put[1]).toBe("parts-library");
    expect(put[2].pack.parts.map((p) => p.id)).toEqual(["local", "theirs"]);
    expect(put[2].removed).toEqual(["gone"]);
    act(() => void result.current.add(putPart(emptyPack("File"), "more", mine("More"), "Sensors")));
    expect(call.mock.calls.filter((c) => c[0] === "PUT")).toHaveLength(2);
    expect(result.current.pack.parts.map((p) => p.id)).toEqual(["local", "theirs", "more"]);
  });

  it("lets the account's copy of a part win, and reads only a real library", () => {
    const a = { pack: putPart(emptyPack(MY_PARTS), "p", mine("Old"), MY_PARTS), removed: [] };
    const b = { pack: putPart(emptyPack(MY_PARTS), "p", mine("New"), MY_PARTS), removed: [] };
    expect(merge(a, b).pack.parts.map((p) => p.name)).toEqual(["New"]);
    expect(readLibrary({ pack: { pack: 3 } })).toBeNull();
    expect(readLibrary({ pack: null, removed: [] })).toBeNull();
  });
});

describe("your blocks (#772)", () => {
  const block = (id: string, version: number): OwnBlock => ({
    spec: { id, version, name: id, shelf: "Your blocks", summary: "", tag: "B", source: { title: "Your own block", url: "" }, parts: [], nets: {}, points: [] },
    defs: {},
  });

  it("keeps the newest version of each, and a deleted one stays deleted", () => {
    const local = { pack: emptyPack(MY_PARTS), removed: ["gone"], blocks: [block("a", 2), block("gone", 1)] };
    const remote = { pack: emptyPack(MY_PARTS), removed: [], blocks: [block("a", 1), block("b", 1)] };
    const merged = merge(local, remote);
    expect(merged.blocks!.map((b) => [b.spec.id, b.spec.version])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });

  it("reads blocks carried in the account's pack", () => {
    const lib = readLibrary({ pack: { ...emptyPack(MY_PARTS), blocks: [block("a", 1)] }, removed: [] })!;
    expect(lib.blocks!.map((b) => b.spec.id)).toEqual(["a"]);
    expect("blocks" in lib.pack).toBe(false);
  });

  it("saves a block for every panel at once, and sends it up inside the pack", async () => {
    localStorage.clear();
    const call = vi.fn(() => Promise.resolve({ pack: null, removed: [] }));
    const one = renderHook(() => useMyLibrary({ call } as never, true));
    const two = renderHook(() => useMyLibrary());
    act(() => one.result.current.saveBlock(block("a", 1)));
    expect(two.result.current.blocks.map((b) => b.spec.id)).toEqual(["a"]);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("PUT", "parts-library", expect.objectContaining({ pack: expect.objectContaining({ blocks: [block("a", 1)] }) })),
    );
    one.unmount();
    two.unmount();
  });
});
