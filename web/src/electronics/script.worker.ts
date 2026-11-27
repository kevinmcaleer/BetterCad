/// <reference lib="webworker" />
import type { ElectronicsDesign } from "@bettercad/electronics";
import { check } from "@bettercad/electronics/erc";
import { checkBoard } from "@bettercad/electronics/drc";
import { runScript } from "@bettercad/electronics/script/run";
import { lockDown } from "./scriptLock";

/**
 * The sandbox a script runs in (#764): a worker made for one run. Its code loads first; then everything that could
 * reach out (the network, storage, other workers, messages back) is taken away before the script's text is run, and
 * the server sends this file with a Content-Security-Policy of `connect-src 'none'` as well. The only way out is the
 * answer this file posts when the script ends.
 */
const post = self.postMessage.bind(self);
const gone = lockDown(self);

self.onmessage = async (e: MessageEvent<{ design: ElectronicsDesign; source: string }>) => {
  self.onmessage = null;
  const run = await runScript(e.data.design, e.data.source, {
    erc: (d) => check(d).map((r) => ({ level: r.level, rule: r.rule, text: r.text })),
    drc: (d) => checkBoard(d).map((r) => ({ level: r.level, rule: r.rule, text: r.text })),
  });
  post({ ...run, gone });
};
