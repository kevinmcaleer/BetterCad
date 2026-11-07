import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageOf, ping } from "./ping";
import { parseRoute } from "./route";

describe("page counts", () => {
  beforeEach(() => sessionStorage.clear());

  it("counts each page once per session", () => {
    const send = vi.fn(() => Promise.resolve());
    expect(ping(parseRoute("#/"), send)).toBe(true);
    expect(ping(parseRoute("#/"), send)).toBe(false);
    expect(ping(parseRoute("#/library"), send)).toBe(true);
    expect(send.mock.calls).toEqual([["editor"], ["library"]]);
  });

  it("names a sample apart from the editor, and never counts the gallery", () => {
    expect(pageOf(parseRoute("#/sample/bracket"))).toBe("sample");
    expect(pageOf(parseRoute("#/privacy"))).toBe("privacy");
    expect(ping(parseRoute("#/gallery"), vi.fn())).toBe(false);
  });

  it("doesn't mind a server that isn't there", () => {
    expect(ping(parseRoute("#/terms"), () => Promise.reject(new Error("offline")))).toBe(true);
  });
});
