import { useEffect, useState } from "react";
import type { FileHandle } from "../files/fileStore";

/**
 * Installing BetterCad as an app (#95). Chromium offers the install prompt once the page qualifies; it is held back
 * here and shown only when you choose Install from the account menu, so it never pops up on its own.
 */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let held: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

/** Starts listening for the browser's install prompt. Call once, before the app mounts. */
export function listenForInstall(target: Window | undefined = typeof window === "undefined" ? undefined : window) {
  if (!target) return;
  target.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    held = e as InstallPrompt;
    tell();
  });
  target.addEventListener("appinstalled", () => {
    held = null;
    tell();
  });
}

/** Shows the browser's install dialog. True when you installed it. */
export async function install(): Promise<boolean> {
  const p = held;
  if (!p) return false;
  held = null;
  tell();
  await p.prompt();
  return (await p.userChoice).outcome === "accepted";
}

/** Whether the browser will install BetterCad now. */
export function useInstallable(): boolean {
  const [can, setCan] = useState(!!held);
  useEffect(() => {
    const l = () => setCan(!!held);
    listeners.add(l);
    l();
    return () => void listeners.delete(l);
  }, []);
  return can;
}

interface LaunchParams {
  files: FileHandle[];
}
interface LaunchQueue {
  setConsumer(fn: (p: LaunchParams) => void): void;
}

/**
 * A .bcad file double-clicked when BetterCad is installed (the manifest's file_handlers): `open` gets its handle, so a
 * save writes back to the same file.
 */
export function useLaunchFiles(open: (handle: FileHandle) => void) {
  useEffect(() => {
    const q = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    q?.setConsumer((p) => {
      const h = p.files[0];
      if (h) open(h);
    });
  }, [open]);
}
