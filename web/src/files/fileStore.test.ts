import { describe, expect, it, vi } from "vitest";
import { createFileStore, type FileHandle, type PickerWindow, type Recent } from "./fileStore";
import { memoryKV } from "./idb";

/** jsdom's Blob has no text(). */
const read = (b: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(b);
  });

/** A file handle over a string, standing in for one the browser hands back. */
function handle(name: string, text = "") {
  let body = text;
  let gone = false;
  const h: FileHandle & { body(): string; remove(): void } = {
    kind: "file",
    name,
    getFile: async () => {
      if (gone) throw new DOMException("gone", "NotFoundError");
      return new File([body], name);
    },
    createWritable: async () => {
      let next = "";
      return {
        write: async (d: BlobPart) => {
          next += typeof d === "string" ? d : await read(d as Blob);
        },
        close: async () => {
          body = next;
        },
      };
    },
    isSameEntry: async (o) => o === h,
    queryPermission: async () => "granted",
    body: () => body,
    remove: () => {
      gone = true;
    },
  };
  return h;
}

const abort = () => Promise.reject(new DOMException("cancelled", "AbortError"));

function picker(over: Partial<PickerWindow> = {}) {
  return { ...window, showOpenFilePicker: vi.fn(abort), showSaveFilePicker: vi.fn(abort), ...over } as unknown as PickerWindow & Window;
}

describe("FileStore with the File System Access API (#83)", () => {
  it("saves as through the picker, then saves in place without asking", async () => {
    const h = handle("Bracket.bcad");
    const win = picker({ showSaveFilePicker: vi.fn(async () => h) });
    const fs = createFileStore(win, memoryKV<Recent>());
    expect(fs.kind).toBe("disk");
    const first = await fs.save("one", "Bracket.bcad");
    expect(win.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "Bracket.bcad" }));
    expect(first).toMatchObject({ name: "Bracket.bcad", inPlace: true, handle: h });
    expect(h.body()).toBe("one");
    await fs.save("two", "Bracket.bcad", first!.handle);
    expect(win.showSaveFilePicker).toHaveBeenCalledTimes(1);
    expect(h.body()).toBe("two");
  });

  it("treats a cancelled picker as nothing happening", async () => {
    const fs = createFileStore(picker(), memoryKV<Recent>());
    expect(await fs.saveAs("x", "a.bcad")).toBeUndefined();
    expect(await fs.open()).toBeUndefined();
  });

  it("opens a file and keeps up to 10 recent ones, newest first", async () => {
    const files = Array.from({ length: 12 }, (_, i) => handle(`m${i}.bcad`, `text ${i}`));
    const fs = createFileStore(picker({ showOpenFilePicker: vi.fn(async () => [files[0]!]) }), memoryKV<Recent>());
    const o = await fs.open();
    expect(await read(o!.file)).toBe("text 0");
    let t = 1000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => (t += 10));
    for (const f of files) await fs.remember(f, { name: f.name });
    await fs.remember(files[3]!, { name: files[3]!.name });
    const r = await fs.recent();
    expect(r).toHaveLength(10);
    expect(r[0]!.name).toBe("m3.bcad");
    expect(r.map((x) => x.name)).not.toContain("m0.bcad");
    now.mockRestore();
  });

  it("says when a recent file has moved or been deleted, and forgets it", async () => {
    const h = handle("Gone.bcad", "x");
    const fs = createFileStore(picker(), memoryKV<Recent>());
    await fs.remember(h, { name: "Gone.bcad" });
    const [r] = await fs.recent();
    h.remove();
    await expect(fs.openRecent(r!.id)).rejects.toThrow("Gone.bcad has moved or been deleted.");
    expect(await fs.recent()).toEqual([]);
  });

  it("asks again for permission to a remembered file", async () => {
    const h = { ...handle("Ask.bcad", "y"), queryPermission: vi.fn(async () => "prompt" as const), requestPermission: vi.fn(async () => "denied" as const) };
    const fs = createFileStore(picker(), memoryKV<Recent>());
    await fs.remember(h, { name: "Ask.bcad" });
    const [r] = await fs.recent();
    await expect(fs.openRecent(r!.id)).rejects.toThrow("BetterCad needs your permission to open Ask.bcad.");
    expect(h.requestPermission).toHaveBeenCalled();
  });
});

describe("exported files (#86)", () => {
  it("asks where to save one file, with its type", async () => {
    const h = handle("Ball.stl");
    const win = picker({ showSaveFilePicker: vi.fn(async () => h) });
    const fs = createFileStore(win, memoryKV<Recent>());
    const r = await fs.saveFiles([{ name: "Ball.stl", data: new TextEncoder().encode("solid").buffer as ArrayBuffer, mime: "model/stl" }]);
    expect(r).toEqual({ names: ["Ball.stl"], inPlace: true });
    expect(win.showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: "Ball.stl", types: [{ description: "Ball.stl", accept: { "model/stl": [".stl"] } }] });
    expect(h.body()).toBe("solid");
  });

  it("asks where to save before a file's bytes are ready, while the click still counts", async () => {
    const h = handle("Box.png");
    const win = picker({ showSaveFilePicker: vi.fn(async () => h) });
    const fs = createFileStore(win, memoryKV<Recent>());
    let ready!: (b: ArrayBuffer) => void;
    const saving = fs.saveFiles([{ name: "Box.png", data: new Promise<ArrayBuffer>((r) => (ready = r)), mime: "image/png" }]);
    expect(win.showSaveFilePicker).toHaveBeenCalled();
    ready(new TextEncoder().encode("png").buffer as ArrayBuffer);
    expect(await saving).toEqual({ names: ["Box.png"], inPlace: true });
    expect(h.body()).toBe("png");
  });

  it("writes several files into a folder you pick", async () => {
    const made = new Map<string, ReturnType<typeof handle>>();
    const dir = { getFileHandle: vi.fn(async (n: string) => made.set(n, handle(n)).get(n)!) };
    const fs = createFileStore(picker({ showDirectoryPicker: vi.fn(async () => dir) }), memoryKV<Recent>());
    const data = new TextEncoder().encode("x").buffer as ArrayBuffer;
    const r = await fs.saveFiles([
      { name: "a.stl", data, mime: "model/stl" },
      { name: "b.stl", data, mime: "model/stl" },
    ]);
    expect(r).toEqual({ names: ["a.stl", "b.stl"], inPlace: true });
    expect([...made.keys()]).toEqual(["a.stl", "b.stl"]);
    expect(made.get("b.stl")!.body()).toBe("x");
  });
});

describe("FileStore without the API (Safari, Firefox)", () => {
  it("downloads the file", async () => {
    const fs = createFileStore(window as PickerWindow & Window, memoryKV<Recent>());
    expect(fs.kind).toBe("download");
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(await fs.save("data", "Bracket.bcad")).toEqual({ name: "Bracket.bcad", inPlace: false });
    expect(click).toHaveBeenCalled();
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(await read(blob)).toBe("data");
    expect(await fs.recent()).toEqual([]);
    click.mockRestore();
  });
});
