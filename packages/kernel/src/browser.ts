import { KernelClient } from "./client";

/** The kernel in a browser: one module worker per tab, started on first use. */
let client: KernelClient | null = null;

export function kernel(): KernelClient {
  client ??= new KernelClient(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "bettercad-kernel" })).start();
  return client;
}
