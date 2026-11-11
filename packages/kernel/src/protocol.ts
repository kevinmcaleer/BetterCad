import type { ModelDoc } from "./document";
import type { KernelErrorData } from "./errors";
import type { BodyMass, ImportInfo, ModelResult, Recognised } from "./occt/model";
import type { RecogniseOptions } from "./recognise";
import type { Reordered } from "./occt/repick";
import type { ImportFormat } from "./imports";
import type { Quality } from "./occt/tessellate";
import type { MeasureResult, TopoRef } from "./occt/measure";
import type { Mate } from "./occt/mates";
import type { Clash } from "./occt/clashes";
import type { SweepResult } from "./sweep";
import type { CheckArea } from "./print/checks";
import type { Orientation, OrientWeights } from "./print/orient";
import type { ExportEstimate, ExportRequest, ExportResult } from "./occt/exporter";

/**
 * The one message protocol between the app and the kernel worker (#44). Every request has an id, a method and typed
 * params; every reply is a result or a KernelError. Results are copied (structured clone): the worker keeps its meshes cached for the next build.
 */
export interface Methods {
  /** Builds a document revision (up to the timeline marker) into meshed, measured bodies. */
  build: { params: { doc: ModelDoc; upTo?: number; quality?: Quality }; result: ModelResult };
  /** Distances, lengths, areas and angles of one or two picks (#71). */
  measure: { params: { doc: ModelDoc; upTo?: number; refs: TopoRef[] }; result: MeasureResult };
  /** How big an export would be (#86): triangles and bytes at the chosen resolution. Its triangles are kept for the export. */
  estimate: { params: ExportRequest; result: ExportEstimate };
  /** STL, 3MF or STEP files from the exact B-rep (#80, #81). */
  export: { params: ExportRequest & { name: string }; result: ExportResult };
  /** Reads a file to import (#82): its bodies, kept ready for the build that follows. Posts progress. */
  inspect: { params: { name: string; format: ImportFormat; blob: string; data: string }; result: ImportInfo };
  /** What an imported mesh body was made from (#437): holes, round faces and round edges, in the world. */
  recognise: { params: { doc: ModelDoc; upTo?: number; body: string } & RecogniseOptions; result: Recognised };
  /** Wall thickness (#101) on bodies' meshes: the per-vertex tint and the thin areas. */
  thickness: {
    params: { bodies: { id: string; positions: Float32Array; indices: Uint32Array }[]; threshold: number };
    result: { id: string; values: Float32Array; areas: CheckArea[]; min: number | null }[];
  };
  /** Orientation suggestions (#103) for the bodies that print, together, in world space. */
  orient: {
    params: { bodies: { positions: Float32Array; indices: Uint32Array; faceTris?: Uint32Array }[]; limit: number; weights?: OrientWeights };
    result: Orientation[];
  };
  /** Mating faces between printed bodies (#184): pins in holes and facing flat faces, with their gaps. */
  mates: { params: { doc: ModelDoc; upTo?: number; limit?: number }; result: Mate[] };
  /** Bodies that overlap or touch at the document's pose (#178), biggest overlap first. Posts progress. */
  clashes: { params: { doc: ModelDoc; upTo?: number; sameLink?: boolean; references?: boolean }; result: Clash[] };
  /**
   * The clash sweep (#179): where bodies hit as each joint moves through its range ("each", or one joint's id), or as
   * all of them move together ("together", `samples` poses). Posts progress.
   */
  sweep: {
    params: { doc: ModelDoc; upTo?: number; joint?: string; step?: { hinge?: number; slider?: number }; samples?: number; references?: boolean };
    result: SweepResult;
  };
  /** Mass, centre of mass and inertia of each body that has mass (#174), from the document's material and infill. */
  mass: { params: { doc: ModelDoc; upTo?: number }; result: BodyMass[] };
  /** Moves a timeline step (#286), finding moved fillets' and shells' edges and faces again by place. */
  reorder: { params: { doc: ModelDoc; id: string; beforeId: string | null }; result: Reordered };
  /** Round trip, for tests and to check the worker is alive. */
  ping: { params: Record<string, never>; result: { ok: true; engine: string } };
}
export type Method = keyof Methods;

export type Request<M extends Method = Method> = { kind: "call"; id: number; method: M; params: Methods[M]["params"] } | { kind: "cancel"; id: number };

export type Response<M extends Method = Method> =
  | { kind: "result"; id: number; result: Methods[M]["result"] }
  | { kind: "error"; id: number; error: KernelErrorData }
  | { kind: "progress"; id: number; fraction: number; steps?: [number, number] }
  | { kind: "load"; fraction: number }
  | { kind: "ready"; ms: number; load?: { download?: number; start?: number } }
  | { kind: "load-error"; error: KernelErrorData };
