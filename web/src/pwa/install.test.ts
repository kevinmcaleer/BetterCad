import { describe, expect, it, vi } from "vitest";
import { install, listenForInstall } from "./install";

describe("installing the app (#95)", () => {
  it("holds the browser's prompt back until Install is chosen, then shows it once", async () => {
    const win = new EventTarget() as unknown as Window;
    listenForInstall(win);
    expect(await install()).toBe(false);
    const prompt = vi.fn(async () => undefined);
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(await install()).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(await install()).toBe(false);
  });
});
