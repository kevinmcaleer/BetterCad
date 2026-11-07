/**
 * The last error the app caught (#109), for a problem report, and the ones that should offer one: an exception
 * nothing handled, or the geometry engine crashing. A step that failed to build is recorded quietly; its own
 * banner already explains it.
 */
export interface Caught {
  message: string;
  stack?: string;
  at: number;
}

let last: Caught | null = null;
const listeners = new Set<(c: Caught) => void>();

export function caught(message: string, opts: { stack?: string; show?: boolean } = {}): void {
  last = { message, stack: opts.stack, at: Date.now() };
  if (opts.show) listeners.forEach((l) => l(last!));
}

/** "message" and the first lines of its stack, for the report. */
export function lastError(): string | null {
  if (!last) return null;
  const stack = last.stack?.split("\n").slice(0, 6).join("\n");
  return stack && !stack.includes(last.message) ? `${last.message}\n${stack}` : (stack ?? last.message);
}

export function onCaught(fn: (c: Caught) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Records uncaught errors and rejections, and offers a report for them. */
export function watchWindow(win: Window = window): () => void {
  const onError = (e: ErrorEvent) => {
    // A script on another origin or a browser extension gives no message: nothing useful to report.
    if (!e.message || e.message === "Script error.") return;
    caught(e.message, { stack: e.error instanceof Error ? e.error.stack : undefined, show: true });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string; stack?: string; code?: string } | undefined;
    // A cancelled kernel call is how a newer build replaces an older one, not a problem.
    if (r?.code === "cancelled") return;
    caught(r?.message ?? String(r), { stack: r?.stack, show: true });
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}

/** For tests. */
export function resetCaught(): void {
  last = null;
}
