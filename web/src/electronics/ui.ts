import type { ComponentDef, CopperLayer, P2 } from "@bettercad/electronics";
import type { LayerId } from "./drawBoard";

/** Which electronics view covers the 3D view. 3D is the model itself, so it is "no electronics view". */
export type EView = "schematic" | "pcb";
export type SchTool = "select" | "wire" | "label" | "noConnect" | "junction" | "place";
export type PcbTool = "select" | "route" | "via" | "hole" | "text" | "pour" | "keepout";

export interface EUi {
  view: EView | null;
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
  layer: CopperLayer;
  hidden: LayerId[];
  /** Cards that are open over the view. */
  card: "changes" | "components" | "checks" | "table" | "export" | "open" | "board" | "order" | null;
  /** A place a check points at: the view brings it into the middle and rings it. On the board its sheet is "board". */
  spot: { sheet: string; at: P2; n: number } | null;
  /** Goes up by one to ask the open view to bring the selection into the middle. */
  focus: number;
  /** The grid parts, tracks and holes snap to on the board, mm. */
  grid: number;
  /** Routing stops at anything the rules say a track must keep clear of. Off lets a track go anywhere. */
  keepClear: boolean;
  /** Connections the open board still needs, once its copper is counted. Null until the board has been looked at. */
  unrouted: number | null;
}

/** The board grids on offer, mm: round metric steps and the inch pitches parts are made on. */
export const BOARD_GRIDS = [0.1, 0.25, 0.5, 1, 1.27, 2.54];

const start = (): EUi => ({
  view: null,
  sheet: null,
  schTool: "select",
  pcbTool: "select",
  selected: [],
  net: null,
  placing: null,
  placingPkg: 0,
  layer: "top",
  hidden: [],
  card: null,
  spot: null,
  focus: 0,
  grid: 0.5,
  keepClear: true,
  unrouted: null,
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
