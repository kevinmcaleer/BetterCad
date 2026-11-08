import { afterEach, describe, expect, it } from "vitest";
import { SEEN_KEY, loadSeen, saveSeen, unseenIds } from "./seen";

afterEach(() => localStorage.clear());

describe("what's new bookmark", () => {
  it("shows nothing on a first visit", () => {
    expect(loadSeen()).toBeNull();
    expect(unseenIds(["2026-11-08-a"], loadSeen())).toEqual([]);
  });
  it("lists the notes you haven't seen, even from the same day", () => {
    saveSeen(["2026-11-08-mirror"]);
    expect(unseenIds(["2026-11-09-gears", "2026-11-08-mirror", "2026-11-08-arm"], loadSeen())).toEqual(["2026-11-09-gears", "2026-11-08-arm"]);
  });
  it("treats garbled storage as a first visit", () => {
    localStorage.setItem(SEEN_KEY, "2026-11-08-old-format");
    expect(loadSeen()).toBeNull();
  });
});
