import { describe, expect, it, vi } from "vitest";
import { unzip } from "@bettercad/kernel/zip";
import { addPart, newDoc, updateFeature } from "../state/document";
import { ActionLog, editSummary } from "./actionLog";
import { browserName, infoText, reportZip, sendReport, type ReportBody } from "./report";

describe("the action log", () => {
  it("keeps the last 20, oldest first", () => {
    const log = new ActionLog();
    for (let i = 0; i < 25; i++) log.record({ id: `c${i}`, at: i });
    const all = log.list();
    expect(all).toHaveLength(20);
    expect(all[0]).toEqual({ id: "c5", at: 5 });
    expect(all.at(-1)).toEqual({ id: "c24", at: 24 });
  });

  it("describes an edit by feature id and type only", () => {
    const a = addPart(newDoc(), "box", "b");
    const b = addPart(a, "cylinder", "c");
    const added = b.features.at(-1)!;
    expect(editSummary(a, b)).toBe(`+${added.id} add`);
    const renamed = updateFeature(b, added.id, { name: "My secret part" });
    const s = editSummary(b, renamed);
    expect(s).toBe(`~${added.id} add`);
    expect(s).not.toContain("secret");
    expect(editSummary(renamed, a)).toBe(`−${added.id} add`);
  });
});

const body = (model: string | null): ReportBody => ({
  description: "The fillet failed on the lid",
  model,
  info: {
    app: "1.2.3",
    browser: "Chrome 130 on macOS",
    error: "fillet: BRep_API: command not done",
    actions: [{ id: "tool.fillet", at: Date.UTC(2026, 10, 7, 9, 30, 5) }],
  },
});

describe("the report", () => {
  it("names the browser without the rest of the user agent", () => {
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe(
      "Chrome 130 on macOS",
    );
    expect(browserName("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox 131 on Linux");
    expect(
      browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
    ).toBe("Safari 18 on iOS");
  });

  it("lists what is collected", () => {
    expect(infoText(body(null).info)).toBe(
      ["App: 1.2.3", "Browser: Chrome 130 on macOS", "Last error: fillet: BRep_API: command not done", "", "Last 1 actions:", "  09:30:05 tool.fillet"].join(
        "\n",
      ),
    );
  });

  it("zips the README, the report and the model", () => {
    const files = unzip(reportZip(body('{"schema":1}')));
    expect([...files.keys()]).toEqual(["README.txt", "report.json", "model.bcad"]);
    const dec = new TextDecoder();
    expect(dec.decode(files.get("README.txt"))).toContain("bug report at https://github.com/kevinmcaleer/BetterCad/issues/new/choose");
    expect(dec.decode(files.get("README.txt"))).toContain("The fillet failed on the lid");
    expect(JSON.parse(dec.decode(files.get("report.json"))).info.actions[0].id).toBe("tool.fillet");
    expect(dec.decode(files.get("model.bcad"))).toBe('{"schema":1}');
    // Without the model, there's no model in it.
    expect([...unzip(reportZip(body(null))).keys()]).toEqual(["README.txt", "report.json"]);
  });

  it("sends, and says why when it can't", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ id: "2f3a9c01" }), { status: 201 }));
    expect(await sendReport(body(null), ok as unknown as typeof fetch)).toEqual({ ok: true, id: "2f3a9c01" });
    const busy = vi.fn(async () => new Response(JSON.stringify({ detail: "Try again later" }), { status: 429 }));
    expect(await sendReport(body(null), busy as unknown as typeof fetch)).toEqual({ ok: false, error: "Try again later" });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendReport(body(null), offline as unknown as typeof fetch)).toEqual({ ok: false, error: "You're offline, or the server can't be reached." });
  });
});
