/**
 * The board's worker: one script that checks a board (#644) and routes one (#647), so the board's model is loaded
 * for a worker once. Each job gets a worker of its own; a routing worker is ended to stop it.
 */
export const boardWorker = (name: string) => new Worker(new URL("./boardCheck.worker.ts", import.meta.url), { type: "module", name });
