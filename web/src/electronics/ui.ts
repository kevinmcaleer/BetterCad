import type { ComponentDef, CopperLayer, ElectronicsDesign, P2 } from "@bettercad/electronics";
import type { BuiltBlock } from "@bettercad/electronics/blocks";

/** A block being placed: the block, and the edit that drops it, which comes with the lazily loaded Blocks tab. */
export interface PlacingBlock {
  built: BuiltBlock;
  place: (d: ElectronicsDesign, sheet: string, at: P2) => { design: ElectronicsDesign; ids: string[] };
}
import type { LayerId } from "./drawBoard";

/** Which electronics view covers the 3D view. 3D is the model itself, so it is "no electronics view". */
export type EView = "schematic" | "pcb";
export type SchTool = "select" | "wire" | "label" | "noConnect" | "junction" | "place" | "text" | "line" | "rect" | "circle";
export type PcbTool = "select" | "route" | "via" | "hole" | "fiducial" | "testpoint" | "text" | "pour" | "keepout" | "measure";

export interface EUi {
  view: EView | null;
  /** The view open last in this model, which the Electronics tab opens again (#731). */
  last: EView;
  /** The sheet that is showing; the first when it is none of them. */
  sheet: string | null;
  schTool: SchTool;
  pcbTool: PcbTool;
  /** What is selected: part ids, and ids of wires, labels, tracks and the rest. Carried between the views. */
  selected: string[];
  /** A net lit up everywhere. */
  net: string | null;
  /** The component riding on the pointer while placing. */
  placing: ComponentDef | null;
  /** Which of its packages the placed part will use. */
  placingPkg: number;
  /** A circuit block riding on the pointer while placing (#768). */
  placingBlock: PlacingBlock | null;
  layer: CopperLayer;
  hidden: LayerId[];
  /** Cards that are open over the view. */
  card: "changes" | "components" | "checks" | "table" | "export" | "open" | "board" | "order" | "autoroute" | "find" | "calc" | null;
  /** A place a check points at: the view brings it into the middle and rings it. On the board its sheet is "board". */
  spot: { sheet: string; at: P2; n: number } | null;
  /** Goes up by one to ask the open view to bring the selection into the middle. */
  focus: number;
  /** The grid parts, tracks and holes snap to on the board, mm. */
  grid: number;
  /** Routing stops at anything the rules say a track must keep clear of. Off lets a track go anywhere. */
  keepClear: boolean;
  /** Routing moves other tracks aside when one is in the way (#646). */
  shove: boolean;
  /** Connections the open board still needs, once its copper is counted. Null until the board has been looked at. */
  unrouted: number | null;
  /** The same, by net, for the inspector. */
  airs: Record<string, number> | null;
  /** Tracks and vias on the open board, which Clear routes would take off. Null until the board has been looked at. */
  routed: number | null;
  /** Pours drawn as outlines only, so what is under them shows (#728). */
  pourOutlines: boolean;
  /** A schematic group gone into with a double-click: its things are picked one by one (#766). */
  inGroup: string | null;
}

/** The board grids on offer, mm: round metric steps and the inch pitches parts are made on. */
export const BOARD_GRIDS = [0.1, 0.25, 0.5, 1, 1.27, 2.54];

const start = (): EUi => ({
  view: null,
  last: "schematic",
  sheet: null,
  schTool: "select",
  pcbTool: "select",
  selected: [],
  net: null,
  placing: null,
  placingPkg: 0,
  placingBlock: null,
  layer: "top",
  hidden: [],
  card: null,
  spot: null,
  focus: 0,
  grid: 0.5,
  keepClear: true,
  shove: false,
  unrouted: null,
  airs: null,
  routed: null,
  pourOutlines: false,
  inGroup: null,
});

/**
 * What the electronics workspace is showing and doing. It is view state, not the design: none of it is saved or
 * undone. One small store, because the ribbon, the browser and the view all read it from different places.
 */
function makeUi() {
  let state = start();
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch: Partial<EUi>) => {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    reset: () => {
      state = start();
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export const eui = makeUi();
