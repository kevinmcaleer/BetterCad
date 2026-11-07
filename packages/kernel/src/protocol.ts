import type { ModelDoc } from "./document";
import type { KernelErrorData } from "./errors";
import type { ModelResult } from "./occt/model";
import type { Quality } from "./occt/tessellate";

/**
 * The one message protocol between the app and the kernel worker (#44). Every request has an id, a method and typed
 * params; every reply is a result or a KernelError. Results are copied (structured clone): the worker keeps its meshes cached for the next build.
 */
export interface Methods {
  /** Builds a document revision (up to the timeline marker) into meshed, measured bodies. */
  build: { params: { doc: ModelDoc; upTo?: number; quality?: Quality }; result: ModelResult };
  /** Round trip, for tests and to check the worker is alive. */
  ping: { params: Record<string, never>; result: { ok: true; engine: string } };
}
export type Method = keyof Methods;

export type Request<M extends Method = Method> = { kind: "call"; id: number; method: M; params: Methods[M]["params"] } | { kind: "cancel"; id: number };

export type Response<M extends Method = Method> =
  | { kind: "result"; id: number; result: Methods[M]["result"] }
  | { kind: "error"; id: number; error: KernelErrorData }
  | { kind: "progress"; id: number; fraction: number }
  | { kind: "load"; fraction: number }
  | { kind: "ready"; ms: number }
  | { kind: "load-error"; error: KernelErrorData };
