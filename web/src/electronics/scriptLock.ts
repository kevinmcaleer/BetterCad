/** Names a script must not reach (#764): the network, storage, more code and other threads. */
export const LOCKED = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebTransport",
  "EventSource",
  "importScripts",
  "indexedDB",
  "caches",
  "cookieStore",
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
  "postMessage",
  "close",
  "navigator",
  "location",
  "Request",
  "Response",
  "FileReaderSync",
] as const;

/**
 * Takes each locked name off the worker and everything it inherits from, so neither `fetch` nor
 * `Object.getPrototypeOf(self).fetch` finds it. Returns the names it took.
 */
export function lockDown(scope: object): string[] {
  const gone: string[] = [];
  for (const name of LOCKED) {
    let found = false;
    for (let o: object | null = scope; o; o = Object.getPrototypeOf(o)) {
      if (!Object.prototype.hasOwnProperty.call(o, name)) continue;
      found = true;
      try {
        Reflect.deleteProperty(o, name);
      } catch {
        // Some engines refuse; the define below covers it.
      }
    }
    try {
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false });
    } catch {
      // Already locked.
    }
    if (found) gone.push(name);
  }
  return gone;
}
