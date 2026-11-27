import { scriptApi, type ScriptChange, type ScriptChecks, type ScriptOutput } from "./api";
import type { ElectronicsDesign } from "../model";

/** What one run of a script gives back: its changes (not yet applied) and what it showed, or why it stopped. */
export interface ScriptRun {
  changes: ScriptChange[];
  output: ScriptOutput[];
  error?: string;
}

// The constructor of `async function`s, so a script can `await` (the checks, say) without being wrapped by hand.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (bc: unknown) => Promise<unknown>;

/**
 * Runs a script's text with `bc` as its only name of ours (#764). The sandbox (a locked-down worker) is the caller's
 * job; this is the same in a test and in the worker. A script that throws keeps nothing: its changes are dropped.
 */
export async function runScript(d: ElectronicsDesign, source: string, checks: ScriptChecks = {}): Promise<ScriptRun> {
  const { bc, changes, output } = scriptApi(d, checks);
  try {
    await new AsyncFunction("bc", `"use strict";\n${source}`)(bc);
    return { changes, output };
  } catch (err) {
    return { changes: [], output, error: err instanceof Error ? err.message : String(err) };
  }
}
