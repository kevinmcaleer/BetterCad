import { zip } from "@bettercad/kernel/zip";
import type { Action } from "./actionLog";

/**
 * A problem report (#109): what the person wrote, the model if they chose to attach it, and what the app collected.
 * Sent to the server, or saved as a .zip to email when the server can't be reached.
 */
export interface ReportInfo {
  app: string;
  browser: string;
  /** The last error the app or the geometry engine reported, with its stack when there is one. */
  error: string | null;
  actions: Action[];
}

export interface ReportBody {
  description: string;
  model: string | null;
  info: ReportInfo;
}

/** The browser and platform, from the user agent, without the rest of it. */
export function browserName(ua = navigator.userAgent): string {
  const m = ua.match(/(Firefox|Edg|OPR|Chrome|Version)\/([\d.]+)/);
  const name = m ? (({ Edg: "Edge", OPR: "Opera", Version: "Safari" } as Record<string, string>)[m[1]!] ?? m[1]!) : "Unknown browser";
  // iPhones say "like Mac OS X" and Android says "Linux", so the specific ones go first.
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return `${name} ${m?.[2]?.split(".")[0] ?? ""}${os ? ` on ${os}` : ""}`.replace(/\s+/g, " ").trim();
}

const time = (ms: number) => new Date(ms).toISOString().slice(11, 19);

/** The collected info as the dialog shows it, and as README.txt and the email carry it. */
export function infoText(info: ReportInfo): string {
  return [
    `App: ${info.app}`,
    `Browser: ${info.browser}`,
    `Last error: ${info.error ?? "none"}`,
    "",
    `Last ${info.actions.length} actions:`,
    ...info.actions.map((a) => `  ${time(a.at)} ${a.id}${a.detail ? ` (${a.detail})` : ""}`),
  ].join("\n");
}

/** The .zip to download when the report can't be sent: report.json, the model, and a README saying where it goes. */
export function reportZip(body: ReportBody, now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const readme = [
    "A BetterCad problem report",
    "",
    "It couldn't be sent from the app, so it was saved here instead. Attach this .zip to a",
    "bug report at https://github.com/kevinmcaleer/BetterCad/issues/new/choose",
    "",
    `Saved ${now.toISOString()}.`,
    "",
    "What happened:",
    body.description.trim() || "(Not filled in.)",
    "",
    infoText(body.info),
    "",
    body.model ? "model.bcad is the model that was open." : "The model wasn't attached.",
  ].join("\n");
  return zip([
    { name: "README.txt", data: enc.encode(readme) },
    { name: "report.json", data: enc.encode(JSON.stringify({ description: body.description, info: body.info }, null, 2)) },
    ...(body.model ? [{ name: "model.bcad", data: enc.encode(body.model) }] : []),
  ]);
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Posts the report. Offline, a missing server or a refusal comes back as an error to offer the download. */
export async function sendReport(body: ReportBody, f: typeof fetch = fetch): Promise<SendResult> {
  try {
    const r = await f("api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as { id?: string; detail?: string };
    if (r.ok && data.id) return { ok: true, id: data.id };
    return { ok: false, error: typeof data.detail === "string" ? data.detail : "The server couldn't take the report." };
  } catch {
    return { ok: false, error: "You're offline, or the server can't be reached." };
  }
}
