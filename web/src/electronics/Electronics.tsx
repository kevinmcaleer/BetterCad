import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  applyChanges,
  blocks,
  boardChanges,
  boardSize,
  changePart,
  describeChange,
  emptyDesign,
  isPower,
  netlist,
  realParts,
  tidyValue,
  type ElectronicsDesign,
  type P2,
} from "@bettercad/electronics";
import { Button, ESC, FeaturePanel, PanelNote, PropsPanel, RibbonButton, RibbonGroup, Toolbar, cx, useEscape, type IconName } from "@bettercad/ui";
import type { Sketch } from "@bettercad/sketch";
import type { Command } from "../state/commands";
import type { KernelCall } from "./bodyFile";
import type { ModelFaces } from "./faceOutline";
import { eactions, showView, type EEdit } from "./actions";
import { SchematicCanvas, commitLabel } from "./SchematicCanvas";
import { ELECTRONICS_GUIDE_URL as GUIDE_URL } from "../help/about";
import { eui, type EView, type PcbTool, type SchTool } from "./ui";
import { useEui } from "./useEui";

export { onDesign } from "./design";

// The Components panel brings the library, your own parts and their sync: fetched when it first opens.
const ComponentsCard = lazy(() => import("./Components"));
// The rules check, the parts table and export each load when they are first opened.
// The board's drawing, picking and layers load with the PCB view, so the schematic opens without them.
const BoardView = lazy(() => import("./BoardView"));
const ChecksCard = lazy(() => import("./Checks"));
const PartsTable = lazy(() => import("./PartsTable"));
const ExportSchematic = lazy(() => import("./ExportSchematic"));
const OpenProject = lazy(() => import("./OpenProject"));
const OrderBoard = lazy(() => import("./OrderBoard"));
// The board's own cards: its check, its setup and the numbers of whatever is picked on it.
const BoardChecks = lazy(() => import("./BoardChecks"));
const BoardSetup = lazy(() => import("./BoardSetup"));
const BoardProps = lazy(() => import("./BoardProps"));
const AutoRoute = lazy(() => import("./AutoRoute"));
const SchSheets = lazy(() => import("./SchSheets"));
const PartPreview = lazy(() => import("./PartPreview").then((m) => ({ default: m.PartPreview })));

type Card = NonNullable<ReturnType<typeof eui.get>["card"]>;
const toggle = (card: Card) => () => eui.set({ card: eui.get().card === card ? null : card });

interface Tool {
  id: string;
  label: string;
  short?: string;
  icon: IconName;
  key?: string;
  tip: string;
  group: string;
  on?: boolean;
  disabled?: boolean;
  run: () => void;
}

const arm = (t: SchTool) => () => eui.set({ schTool: eui.get().schTool === t ? "select" : t, placing: null, card: null });
const armPcb = (t: PcbTool) => () => eui.set({ pcbTool: eui.get().pcbTool === t ? "select" : t, card: null });

/** Components: opens the list of parts, or lets go of the part being placed (the way out on a touch screen). */
const pickPart = () => {
  const ui = eui.get();
  if (ui.schTool === "place") eui.set({ schTool: "select", placing: null });
  else eui.set({ card: ui.card === "components" ? null : "components" });
};

/** The tools of the open view, in ribbon order. The ribbon and the compact bar both draw from this. */
function useTools(view: EView, readOnly: boolean): Tool[] {
  const ui = useEui();
  const none = ui.selected.length === 0 && !ui.placing;
  if (view === "schematic")
    return [
      {
        id: "components",
        group: "Place",
        label: "Components",
        icon: "chip",
        key: "P",
        tip: ui.schTool === "place" ? "Stop placing" : "Pick a part and place it",
        on: ui.card === "components" || ui.schTool === "place",
        disabled: readOnly,
        run: pickPart,
      },
      {
        id: "wire",
        group: "Wire",
        label: "Wire",
        icon: "wire",
        key: "W",
        tip: "Join pins with a wire",
        on: ui.schTool === "wire",
        disabled: readOnly,
        run: arm("wire"),
      },
      {
        id: "label",
        group: "Wire",
        label: "Net label",
        short: "Label",
        icon: "netLabel",
        key: "L",
        tip: "Name a net. Wires with the same name are joined",
        on: ui.schTool === "label",
        disabled: readOnly,
        run: arm("label"),
      },
      {
        id: "noConnect",
        group: "Wire",
        label: "Not connected",
        short: "No connect",
        icon: "noConnect",
        key: "Q",
        tip: "Mark a pin you are leaving open on purpose",
        on: ui.schTool === "noConnect",
        disabled: readOnly,
        run: arm("noConnect"),
      },
      {
        id: "junction",
        group: "Wire",
        label: "Junction",
        icon: "junction",
        key: "J",
        tip: "Join two wires where they cross",
        on: ui.schTool === "junction",
        disabled: readOnly,
        run: arm("junction"),
      },
      {
        id: "rotate",
        group: "Edit",
        label: "Rotate",
        icon: "rotate",
        key: "R",
        tip: "Turn the selection a quarter turn",
        disabled: readOnly || none,
        run: () => eactions.current?.rotate(),
      },
      {
        id: "mirror",
        group: "Edit",
        label: "Mirror",
        icon: "flipSide",
        key: "X",
        tip: "Flip the selection left to right",
        disabled: readOnly || none,
        run: () => eactions.current?.mirror(),
      },
      {
        id: "flip",
        group: "Edit",
        label: "Flip",
        icon: "flipSide",
        key: "Y",
        tip: "Flip the selection top to bottom",
        disabled: readOnly || none,
        run: () => eactions.current?.flip?.(),
      },
      {
        id: "delete",
        group: "Edit",
        label: "Delete",
        icon: "trash",
        key: "Del",
        tip: "Delete the selection",
        disabled: readOnly || ui.selected.length === 0,
        run: () => eactions.current?.remove(),
      },
      {
        id: "duplicate",
        group: "Edit",
        label: "Duplicate",
        icon: "copy",
        key: "Ctrl+D",
        tip: "Make a copy of the selection beside it, with fresh names",
        disabled: readOnly || ui.selected.length === 0,
        run: () => eactions.current?.duplicate?.(),
      },
      {
        id: "renumber",
        group: "Edit",
        label: "Renumber",
        icon: "text",
        tip: "Name the parts again in order, top to bottom and left to right",
        disabled: readOnly,
        run: () => eactions.current?.renumber?.(),
      },
      {
        id: "checks",
        group: "Check",
        label: "Rules check",
        short: "Check",
        icon: "rulesCheck",
        key: "E",
        tip: "Look for unconnected pins, clashing outputs and missing power",
        on: ui.card === "checks",
        run: toggle("checks"),
      },
      {
        id: "table",
        group: "Check",
        label: "Parts table",
        short: "Parts",
        icon: "list",
        key: "T",
        tip: "See and change every part in one table",
        on: ui.card === "table",
        run: toggle("table"),
      },
      {
        id: "push",
        group: "Sync",
        label: "Push to PCB",
        icon: "pushPcb",
        tip: "Make the board, or bring it up to date",
        on: ui.card === "changes",
        disabled: readOnly,
        run: toggle("changes"),
      },
      {
        id: "export",
        group: "Sync",
        label: "Export",
        icon: "download",
        tip: "Save the schematic as a PDF, an SVG or a netlist, or the whole design as a KiCad project",
        on: ui.card === "export",
        run: toggle("export"),
      },
      {
        id: "open",
        group: "Sync",
        label: "Open project",
        short: "Open",
        icon: "folder",
        tip: "Open a KiCad or Eagle project: its schematic and its board",
        on: ui.card === "open",
        disabled: readOnly,
        run: toggle("open"),
      },
      { id: "fit", group: "View", label: "Fit", icon: "frame", key: "F", tip: "Fit the schematic in the view", run: () => eactions.current?.fit() },
    ];
  const draw = (id: PcbTool, label: string, icon: IconName, key: string, tip: string): Tool => ({
    id,
    group: "Route",
    label,
    icon,
    key,
    tip,
    on: ui.pcbTool === id,
    disabled: readOnly,
    run: armPcb(id),
  });
  return [
    draw("route", "Route", "route", "W", "Lay a track from a pad, bending at 45°"),
    draw("via", "Via", "via", "V", "Join the top and bottom copper with a plated hole"),
    {
      id: "layer",
      group: "Route",
      label: "Swap side",
      short: "Side",
      icon: "layers",
      key: "L",
      tip: "Work on the other copper layer. While routing, this drops a via",
      disabled: readOnly,
      run: () => eactions.current?.layer?.(),
    },
    { ...draw("hole", "Hole", "hole", "H", "Add a mounting hole for a screw"), group: "Add" },
    { ...draw("text", "Text", "text", "T", "Write on the silkscreen"), group: "Add" },
    {
      id: "picture",
      group: "Add",
      label: "Picture",
      icon: "image",
      tip: "Print a logo or a drawing on the silkscreen",
      disabled: readOnly,
      run: () => eactions.current?.picture?.(),
    },
    { ...draw("pour", "Pour", "pour", "P", "Fill an area with copper on one net, usually ground"), group: "Add" },
    { ...draw("keepout", "Keep-out", "keepOut", "O", "Mark an area tracks and pours stay out of, or cut a hole in the board"), group: "Add" },
    {
      id: "rotate",
      group: "Place",
      label: "Rotate",
      icon: "rotate",
      key: "R",
      tip: "Turn the selected parts a quarter turn",
      disabled: readOnly || none,
      run: () => eactions.current?.rotate(),
    },
    {
      id: "flip",
      group: "Place",
      label: "Flip side",
      icon: "flipSide",
      key: "X",
      tip: "Move the selected parts to the other side of the board",
      disabled: readOnly || none,
      run: () => eactions.current?.mirror(),
    },
    {
      id: "lock",
      group: "Place",
      label: "Lock",
      icon: "lock",
      key: "K",
      tip: "Lock the selected parts in place, or free them",
      disabled: readOnly || none,
      run: () => eactions.current?.lock?.(),
    },
    {
      id: "delete",
      group: "Place",
      label: "Delete",
      icon: "trash",
      key: "Del",
      tip: "Delete what is selected. A part asks first, as it leaves the schematic too",
      disabled: readOnly || none,
      run: () => eactions.current?.remove(),
    },
    {
      id: "board",
      group: "Board",
      label: "Board setup",
      short: "Setup",
      icon: "settings",
      key: "B",
      tip: "Set the board's size, its rules and net classes",
      on: ui.card === "board",
      run: toggle("board"),
    },
    {
      id: "autoroute",
      group: "Board",
      label: "Autoroute",
      icon: "route",
      tip: "Lay tracks for the connections still to make",
      on: ui.card === "autoroute",
      disabled: readOnly,
      run: toggle("autoroute"),
    },
    {
      id: "renumber",
      group: "Board",
      label: "Renumber",
      icon: "text",
      tip: "Name the parts again by where they sit on the board. The schematic follows",
      disabled: readOnly,
      run: () => eactions.current?.renumber?.(),
    },
    {
      id: "checks",
      group: "Board",
      label: "Board check",
      short: "Check",
      icon: "rulesCheck",
      key: "E",
      tip: "Look for shorts, tight gaps and connections left to route",
      on: ui.card === "checks",
      run: toggle("checks"),
    },
    {
      id: "order",
      group: "Board",
      label: "Order the board",
      short: "Order",
      icon: "download",
      tip: "Gerber and drill files, a parts list and a pick and place list for a board house",
      on: ui.card === "order",
      run: toggle("order"),
    },
    {
      id: "push",
      group: "Sync",
      label: "Update from schematic",
      short: "From schematic",
      icon: "pushPcb",
      tip: "Bring the board up to date with the schematic",
      on: ui.card === "changes",
      disabled: readOnly,
      run: () => eui.set({ card: ui.card === "changes" ? null : "changes" }),
    },
    { id: "fit", group: "View", label: "Fit", icon: "frame", key: "F", tip: "Fit the board in the view", run: () => eactions.current?.fit() },
  ];
}

/** The keys and palette entries that only make sense while a view is open. They load, and go, with the view. */
function commands(design: () => ElectronicsDesign): Command[] {
  const schematic = () => eui.get().view === "schematic";
  const pcb = () => eui.get().view === "pcb";
  const board: [PcbTool, string, string, IconName, string][] = [
    ["route", "Route a track", "w", "route", "trace wire copper"],
    ["via", "Via", "v", "via", "hole layer"],
    ["hole", "Mounting hole", "h", "hole", "screw drill"],
    ["text", "Silkscreen text", "t", "text", "label legend"],
    ["pour", "Copper pour", "p", "pour", "fill ground plane zone polygon"],
    ["keepout", "Keep-out or cut-out", "o", "keepOut", "restrict area slot hole"],
  ];
  const views = [
    ["schematic", "Show the schematic", "1", "schematic"],
    ["pcb", "Show the PCB", "2", "pcb"],
    [null, "Show the 3D model", "3", "cube"],
  ] as const;
  const tools: [SchTool, string, string, IconName][] = [
    ["wire", "Wire", "w", "wire"],
    ["label", "Net label", "l", "netLabel"],
    ["noConnect", "Not connected", "q", "noConnect"],
    ["junction", "Junction", "j", "junction"],
  ];
  const e = { scope: "electronics" } as const;
  return [
    ...views.map(([view, label, key, icon]): Command => ({
      ...e,
      id: `electronics.show.${view ?? "model"}`,
      label,
      group: "View",
      icon,
      keys: [key],
      run: () => showView(view, design()),
    })),
    // Sheets (#636): the strip adds, names and moves them; these go from one to the next.
    ...([1, -1] as const).map((step): Command => ({
      ...e,
      id: `electronics.sheet.${step > 0 ? "next" : "previous"}`,
      label: step > 0 ? "Next sheet" : "Previous sheet",
      group: "View",
      icon: "schematic",
      keys: [step > 0 ? "pagedown" : "pageup"],
      when: () => schematic() && design().sheets.length > 1,
      run: () => {
        const all = design().sheets;
        const at = Math.max(
          0,
          all.findIndex((s) => s.id === eui.get().sheet),
        );
        eui.set({ sheet: all[(at + step + all.length) % all.length]!.id, selected: [], net: null, spot: null });
      },
    })),
    ...tools.map(([t, label, key, icon]): Command => ({
      ...e,
      id: `electronics.${t}`,
      label,
      group: "Tools",
      icon,
      keys: [key],
      when: schematic,
      run: arm(t),
    })),
    ...board.map(([t, label, key, icon, keywords]): Command => ({
      ...e,
      id: `electronics.pcb.${t}`,
      label,
      group: "Tools",
      icon,
      keys: [key],
      when: pcb,
      run: armPcb(t),
      keywords,
    })),
    {
      ...e,
      id: "electronics.pcb.layer",
      label: "Swap copper side",
      group: "Tools",
      icon: "layers",
      keys: ["l"],
      when: pcb,
      run: () => eactions.current?.layer?.(),
      keywords: "layer top bottom via",
    },
    { ...e, id: "electronics.pcb.bend", label: "Bend the track the other way", group: "Tools", keys: ["/"], when: pcb, run: () => eactions.current?.bend?.() },
    {
      ...e,
      id: "electronics.pcb.lock",
      label: "Lock or unlock parts",
      group: "Edit",
      icon: "lock",
      keys: ["k"],
      when: pcb,
      run: () => eactions.current?.lock?.(),
    },
    {
      ...e,
      id: "electronics.pcb.board",
      label: "Board setup",
      group: "Tools",
      icon: "settings",
      keys: ["b"],
      when: pcb,
      run: toggle("board"),
      keywords: "size outline rules jlcpcb pcbway net class thickness",
    },
    {
      ...e,
      id: "electronics.pcb.autoroute",
      label: "Autoroute",
      group: "Tools",
      icon: "route",
      when: pcb,
      run: toggle("autoroute"),
      keywords: "autoroute autorouter automatic route tracks finish",
    },
    {
      ...e,
      id: "electronics.pcb.checks",
      label: "Board check",
      group: "Tools",
      icon: "rulesCheck",
      keys: ["e"],
      when: pcb,
      run: toggle("checks"),
      keywords: "drc design rules clearance short unrouted",
    },
    {
      ...e,
      id: "electronics.pcb.order",
      label: "Order the board",
      group: "Tools",
      icon: "download",
      when: pcb,
      run: toggle("order"),
      keywords: "gerber drill excellon bom bill of materials pick and place centroid cpl jlcpcb pcbway export manufacture fab",
    },
    {
      ...e,
      id: "electronics.components",
      label: "Components",
      group: "Tools",
      icon: "chip",
      keys: ["p"],
      when: schematic,
      run: pickPart,
      keywords: "place part resistor capacitor led header library",
    },
    {
      ...e,
      id: "electronics.push",
      label: "Push to PCB",
      group: "Tools",
      icon: "pushPcb",
      run: () => eui.set({ card: "changes" }),
      keywords: "update board sync schematic changes",
    },
    { ...e, id: "electronics.rotate", label: "Rotate", group: "Edit", icon: "rotate", keys: ["r"], run: () => eactions.current?.rotate() },
    { ...e, id: "electronics.mirror", label: "Mirror or flip side", group: "Edit", icon: "flipSide", keys: ["x"], run: () => eactions.current?.mirror() },
    {
      ...e,
      id: "electronics.flip",
      label: "Flip top to bottom",
      group: "Edit",
      icon: "flipSide",
      keys: ["y"],
      when: schematic,
      run: () => eactions.current?.flip?.(),
    },
    { ...e, id: "electronics.delete", label: "Delete", group: "Edit", icon: "trash", keys: ["delete", "backspace"], run: () => eactions.current?.remove() },
    { ...e, id: "electronics.copy", label: "Copy", group: "Edit", icon: "copy", keys: ["mod+c"], when: schematic, run: () => eactions.current?.copy?.() },
    { ...e, id: "electronics.paste", label: "Paste", group: "Edit", keys: ["mod+v"], when: schematic, run: () => eactions.current?.paste?.() },
    {
      ...e,
      id: "electronics.duplicate",
      label: "Duplicate",
      group: "Edit",
      icon: "copy",
      keys: ["mod+d"],
      when: schematic,
      run: () => eactions.current?.duplicate?.(),
    },
    {
      ...e,
      id: "electronics.renumber",
      label: "Renumber the parts",
      group: "Edit",
      icon: "text",
      run: () => eactions.current?.renumber?.(),
      keywords: "annotate references names order",
    },
    {
      ...e,
      id: "electronics.checks",
      label: "Rules check",
      group: "Tools",
      icon: "rulesCheck",
      keys: ["e"],
      when: schematic,
      run: toggle("checks"),
      keywords: "erc electrical errors warnings unconnected",
    },
    {
      ...e,
      id: "electronics.table",
      label: "Parts table",
      group: "Tools",
      icon: "list",
      keys: ["t"],
      when: schematic,
      run: toggle("table"),
      keywords: "bom list values bulk",
    },
    {
      ...e,
      id: "electronics.export",
      label: "Export the schematic",
      group: "Tools",
      icon: "download",
      when: schematic,
      run: toggle("export"),
      keywords: "pdf svg netlist kicad print",
    },
    {
      ...e,
      id: "electronics.open",
      label: "Open a KiCad or Eagle project",
      group: "Tools",
      icon: "folder",
      run: () => eui.set({ view: eui.get().view ?? "schematic", card: "open" }),
      keywords: "import kicad_sch kicad_pcb sch brd fusion electronics schematic board bring in",
    },
    {
      ...e,
      id: "electronics.guide",
      label: "Electronics guide",
      group: "Help",
      icon: "link",
      run: () => window.open(GUIDE_URL, "_blank", "noopener"),
      keywords: "help learn schematic pcb board order gerber how to lesson",
    },
    { ...e, id: "electronics.selectAll", label: "Select all", group: "Edit", keys: ["mod+a"], run: () => eactions.current?.selectAll() },
    { ...e, id: "electronics.fit", label: "Fit in the view", group: "View", icon: "frame", keys: ["f"], run: () => eactions.current?.fit() },
  ];
}

/** The Electronics tab's tools while a view is open (desktop ribbon). */
export function ElectronicsRibbon({ readOnly }: { readOnly?: boolean }) {
  const ui = useEui();
  const tools = useTools(ui.view ?? "schematic", !!readOnly);
  const groups = [...new Set(tools.map((t) => t.group))];
  return (
    <>
      {groups.map((g) => (
        <RibbonGroup key={g} label={g} entries={[]}>
          {tools
            .filter((t) => t.group === g)
            .map((t) => (
              <RibbonButton key={t.id} icon={t.icon} label={t.label} short={t.short} shortcut={t.key} pressed={!!t.on} disabled={t.disabled} onPress={t.run} />
            ))}
        </RibbonGroup>
      ))}
    </>
  );
}

/** Schematic, PCB, 3D: one switcher, in the same place on every screen. A dot marks a view that is behind. */
function Switcher({ behind, onView }: { behind: number; onView: (v: EView | null) => void }) {
  const ui = useEui();
  const item = (id: EView | null, label: string, key: string, dot?: boolean) => (
    <button
      type="button"
      role="tab"
      aria-selected={ui.view === id}
      className={cx("bc-ec-switch-item", ui.view === id && "bc-on")}
      data-tip={`${label} (${key})`}
      aria-keyshortcuts={key}
      onClick={() => onView(id)}
    >
      {label}
      {dot && <span className="bc-ec-dot" role="img" aria-label={`${behind} ${behind === 1 ? "change" : "changes"} behind the schematic`} />}
    </button>
  );
  return (
    <div className="bc-ec-switch" role="tablist" aria-label="Electronics views">
      {item("schematic", "Schematic", "1")}
      {item("pcb", "PCB", "2", behind > 0 && ui.view !== "pcb")}
      {item(null, "3D", "3")}
    </div>
  );
}

/** The change card (#620): what Push to PCB will do, before it does it. */
function ChangeCard({ design, edit, onDone }: { design: ElectronicsDesign; edit: EEdit; onDone: (applied: boolean) => void }) {
  const nl = useMemo(() => netlist(design), [design]);
  const changes = useMemo(() => boardChanges(design, nl), [design, nl]);
  const stuck = changes.some(blocks);
  const first = !design.board;
  // The rules check runs before every push (#634). It is advice: the push goes ahead if you say so.
  const [found, setFound] = useState("");
  useEffect(() => {
    let on = true;
    void import("@bettercad/electronics/erc").then((m) => on && setFound(m.tallyText(m.tally(m.check(design, nl)))));
    return () => {
      on = false;
    };
  }, [design, nl]);
  useEscape(true, () => onDone(false), ESC.panel);
  return (
    <FeaturePanel
      title={first ? "Push to PCB" : "Update the board"}
      icon="pushPcb"
      className="bc-ec-card bc-ec-changes"
      cancel={{ label: changes.length ? "Cancel" : "Close", title: "Leave the board as it is (Esc)", onClick: () => onDone(false) }}
      ok={
        changes.length && !stuck
          ? {
              label: first ? "Make the board" : "Update the board",
              title: "Make these changes on the board",
              onClick: () => {
                edit((d) => applyChanges(d, boardChanges(d)), first ? "Push to PCB" : "Update the board");
                onDone(true);
              },
            }
          : undefined
      }
    >
      {found && (
        <p className="bc-ec-check-sum bc-ec-check-found" role="status">
          The rules check found {found}. <Button size="dense" variant="secondary" label="Show them" onClick={() => eui.set({ card: "checks" })} />
        </p>
      )}
      {changes.length === 0 ? (
        <PanelNote>The board matches the schematic. There is nothing to change.</PanelNote>
      ) : (
        <>
          <PanelNote>
            {stuck ? "Fix these first, then push again." : first ? "This is what will happen." : "The board is behind the schematic. This is what will change."}
          </PanelNote>
          <ul className="bc-ec-change-list" aria-label="Changes">
            {changes.map((c, i) => (
              <li key={i} className={cx(blocks(c) && "bc-ec-blocked", c.kind === "dead-net" && "bc-ec-warned")}>
                {describeChange(c)}
              </li>
            ))}
          </ul>
        </>
      )}
    </FeaturePanel>
  );
}

export interface ElectronicsViewProps {
  design: ElectronicsDesign | undefined;
  edit: EEdit;
  readOnly?: boolean;
  /** The desktop ribbon is showing, so the tools are up there and the compact bar stays away. */
  ribbon?: boolean;
  /** Where the views' own shortcuts and palette entries go while one is open. */
  registry?: { register(list: Command[]): () => void };
  /** The model's name, for exported files and their title block. */
  name?: string;
  /** The model's sketches: a board can take its outline from one. */
  sketches?: { id: string; name: string; sketch: Sketch }[];
  /** The model's bodies and what is picked on them: a board can take its outline from a flat face (#638). */
  model?: ModelFaces;
  /** The model has its Board step (#650), so the board stands in 3D; and how to add the step when it has not. */
  inModel?: boolean;
  onAddBoard?: () => void;
  /** Opens the sample board (#666) as a new model. */
  onSample?: () => void;
  /** The geometry engine, for reading a file picked as a part's 3D body (#628). */
  call?: KernelCall;
}

/**
 * The electronics workspace (#617, #619): the schematic or the board covers the 3D view, under the floating cards.
 * Laid out as Kev picked on 2026-11-24: switcher top centre, layers bottom right, checks strip along the bottom.
 */
export default function ElectronicsView({
  design: saved,
  edit,
  readOnly,
  ribbon,
  registry,
  name,
  sketches,
  model,
  inModel,
  onAddBoard,
  onSample,
  call,
}: ElectronicsViewProps) {
  const ui = useEui();
  const blank = useRef(emptyDesign());
  const design = saved ?? blank.current;
  const view = ui.view ?? "schematic";
  const sheet = design.sheets.find((s) => s.id === ui.sheet) ?? design.sheets[0]!;
  const tools = useTools(view, !!readOnly);
  const nl = useMemo(() => netlist(design), [design]);
  const changes = useMemo(() => boardChanges(design, nl), [design, nl]);
  const behind = design.board ? changes.length : 0;
  const left = ui.unrouted ?? 0;
  const [ask, setAsk] = useState<{ at: P2; screen: P2; id?: string; name?: string } | null>(null);
  const [text, setText] = useState("");
  useEffect(() => setText(ask?.name ?? ""), [ask]);
  useEscape(!!ask, () => setAsk(null), ESC.overlay);
  const go = (to: EView | null) => showView(to, design);
  const latest = useRef(design);
  latest.current = design;
  useEffect(() => registry?.register(commands(() => latest.current)), [registry]);
  const loose = nl.floating.length + nl.nets.reduce((n, x) => n + x.openEnds.length, 0);
  const size = design.board ? boardSize(design.board) : null;

  return (
    <div className={cx("bc-electronics", `bc-ec-${view}`)} data-view={view}>
      {view === "schematic" ? (
        <SchematicCanvas key={sheet.id} design={design} sheet={sheet} edit={edit} readOnly={readOnly} onAskLabel={setAsk} />
      ) : (
        <Suspense fallback={null}>
          <BoardView design={design} edit={edit} readOnly={readOnly} />
        </Suspense>
      )}

      <Switcher behind={behind} onView={go} />

      {view === "schematic" && (!readOnly || design.sheets.length > 1) && (
        <Suspense fallback={null}>
          <SchSheets design={design} open={sheet.id} edit={edit} readOnly={readOnly} />
        </Suspense>
      )}

      {!ribbon && (
        <Toolbar label={view === "schematic" ? "Schematic tools" : "PCB tools"} className="bc-ec-tools">
          {tools.map((t) => (
            <Button
              key={t.id}
              icon={t.icon}
              title={`${t.label}: ${t.tip}`}
              aria-label={t.label}
              shortcut={t.key}
              on={t.on}
              disabled={t.disabled}
              onClick={t.run}
            />
          ))}
        </Toolbar>
      )}

      {view === "pcb" && !design.board && (
        <div className="bc-ec-empty" role="status">
          <p>There is no board yet.</p>
          <p className="bc-note">Draw the schematic first, then push it to a PCB.</p>
          <Button variant="primary" icon="schematic" label="Go to the schematic" onClick={() => go("schematic")} />
        </div>
      )}
      {view === "schematic" && design.parts.length === 0 && ui.schTool === "select" && !ui.card && !readOnly && (
        <div className="bc-ec-empty" role="status">
          <p>Start with a part.</p>
          <p className="bc-note">Place parts, join their pins with wires, then push the schematic to a PCB.</p>
          <Button variant="primary" icon="chip" label="Components" shortcut="P" onClick={() => eui.set({ card: "components" })} />
          {onSample && <Button icon="folder" label="Open the sample board" onClick={onSample} />}
          <Button icon="folder" label="Open a KiCad or Eagle project" onClick={() => eui.set({ card: "open" })} />
          <a className="bc-note" href={GUIDE_URL} target="_blank" rel="noreferrer">
            Read the electronics guide
          </a>
        </div>
      )}

      {ui.card === "changes" && !readOnly && (
        <ChangeCard
          design={design}
          edit={edit}
          onDone={(applied) => {
            eui.set({ card: null });
            if (applied && view === "schematic") go("pcb");
          }}
        />
      )}
      {ui.card === "open" && !readOnly && (
        <Suspense fallback={null}>
          <OpenProject
            replaces={design.parts.length > 0 || !!design.board}
            onClose={() => eui.set({ card: null })}
            onOpen={(opened) => {
              edit(() => opened, "Open a project");
              eui.set({ card: null, sheet: null, selected: [], net: null, spot: null, unrouted: null });
              // Once the new sheet is drawn, bring it all into view.
              setTimeout(() => eactions.current?.fit(), 50);
            }}
          />
        </Suspense>
      )}
      {view === "schematic" && (
        <Suspense fallback={null}>
          {ui.card === "components" && !readOnly && (
            <ComponentsCard onClose={() => eui.set({ card: null })} design={design} edit={edit} {...(call ? { call } : {})} />
          )}
          {ui.card === "checks" && <ChecksCard design={design} edit={edit} readOnly={readOnly} onClose={() => eui.set({ card: null })} />}
          {ui.card === "table" && <PartsTable design={design} edit={edit} readOnly={readOnly} onClose={() => eui.set({ card: null })} />}
          {ui.card === "export" && <ExportSchematic design={design} sheet={sheet} name={name || "Schematic"} onClose={() => eui.set({ card: null })} />}
        </Suspense>
      )}
      {view === "pcb" && design.board && (
        <Suspense fallback={null}>
          {ui.card === "checks" && <BoardChecks design={design} edit={edit} readOnly={readOnly} onClose={() => eui.set({ card: null })} />}
          {ui.card === "autoroute" && <AutoRoute design={design} edit={edit} readOnly={readOnly} onClose={() => eui.set({ card: null })} />}
          {ui.card === "table" && <PartsTable design={design} edit={edit} readOnly={readOnly} onClose={() => eui.set({ card: "order" })} />}
          {ui.card === "order" && (
            <OrderBoard design={design} name={name || "Board"} onClose={() => eui.set({ card: null })} onParts={() => eui.set({ card: "table" })} />
          )}
          {ui.card === "board" && (
            <BoardSetup
              design={design}
              edit={edit}
              readOnly={readOnly}
              sketches={sketches}
              model={model}
              inModel={inModel}
              onAddBoard={onAddBoard}
              onClose={() => eui.set({ card: null })}
            />
          )}
        </Suspense>
      )}

      {ask && (
        <form
          className="bc-ec-ask"
          style={{ left: ask.screen[0], top: ask.screen[1] }}
          onSubmit={(e) => {
            e.preventDefault();
            commitLabel(edit, sheet.id, ask, text);
            setAsk(null);
          }}
        >
          <input
            className="bc-text"
            aria-label="Net name"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setAsk(null)}
            placeholder="Net name"
          />
        </form>
      )}

      <div className="bc-ec-status" role="status" aria-label="Electronics status">
        {view === "schematic" ? (
          <>
            <button
              type="button"
              className={cx("bc-ec-pill", loose ? "bc-warn" : "bc-ok")}
              data-tip="Open the rules check (E)"
              onClick={() => eui.set({ card: "checks" })}
            >
              {loose
                ? `${loose} ${loose === 1 ? "pin or wire end is" : "pins or wire ends are"} not connected`
                : design.parts.length
                  ? "Everything is connected"
                  : "Nothing placed yet"}
            </button>
            {behind > 0 && !readOnly && (
              <button type="button" className="bc-ec-pill bc-warn" onClick={() => eui.set({ card: "changes" })}>
                PCB is {behind} {behind === 1 ? "change" : "changes"} behind
              </button>
            )}
            <span className="bc-ec-status-far">
              {ui.schTool === "place" && ui.placing
                ? `Placing ${ui.placing.name}. Click to place, Esc to stop.`
                : ui.schTool === "wire"
                  ? "Click a pin to start a wire, click again to turn or finish."
                  : ui.net
                    ? `Net ${ui.net}`
                    : "Grid 2.54 mm"}
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className={cx("bc-ec-pill", left ? "bc-warn" : "bc-ok")}
              data-tip="Open the board check (E)"
              disabled={!design.board}
              onClick={() => eui.set({ card: "checks" })}
            >
              {left ? `${left} ${left === 1 ? "connection" : "connections"} left to route` : design.board ? "Every connection is routed" : "No board yet"}
            </button>
            {behind > 0 && !readOnly && (
              <button type="button" className="bc-ec-pill bc-warn" onClick={() => eui.set({ card: "changes" })}>
                {behind} {behind === 1 ? "change" : "changes"} from the schematic
              </button>
            )}
            <span className="bc-ec-status-far">{size ? `Board ${size.w} × ${size.h} mm · Grid ${ui.grid} mm` : ""}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** The right-hand card: the picked part's value, package and part numbers, or a summary of the design. */
export function ElectronicsProps({ design: saved, edit, readOnly }: { design: ElectronicsDesign | undefined; edit: EEdit; readOnly?: boolean }) {
  const ui = useEui();
  const ids = useId();
  const design = saved ?? emptyDesign();
  const nl = useMemo(() => netlist(design), [design]);
  // A symbol's id on the schematic, a part's own id on the board.
  const partId =
    design.sheets.flatMap((s) => s.symbols).find((y) => ui.selected.includes(y.id))?.part ?? design.parts.find((p) => ui.selected.includes(p.id))?.id;
  const part = ui.selected.length === 1 ? design.parts.find((p) => p.id === partId) : undefined;
  const def = part && design.defs[part.def];
  if (part && def) {
    const at = design.board?.placements.find((p) => p.part === part.id);
    const power = isPower(design, part);
    const set = (change: Parameters<typeof changePart>[2], label: string) =>
      edit((d) => changePart(d, part.id, change), label, `ec-part-${part.id}-${Object.keys(change).join()}`);
    const nets = def.symbol.pins.map((p) => ({ pin: p, net: nl.of.get(`${part.id}:${p.number}`) }));
    return (
      <PropsPanel
        sections={[
          {
            id: "ec-part",
            title: power ? def.name : `${part.ref} · ${def.name}`,
            content: (
              <>
                <label className="bc-field-label" htmlFor={`${ids}v`}>
                  {power ? "Net" : "Value"}
                </label>
                <input
                  id={`${ids}v`}
                  className="bc-text"
                  value={part.value}
                  disabled={readOnly}
                  onChange={(e) => set({ value: e.target.value }, "Change the value")}
                  onBlur={(e) => {
                    // Shorthand is read when you leave the field: 4k7 becomes 4.7 kΩ.
                    const tidy = power ? e.target.value : tidyValue(e.target.value, def.prefix);
                    if (tidy !== part.value) set({ value: tidy }, "Change the value");
                  }}
                />
                {!power && (
                  <>
                    <label className="bc-field-label" htmlFor={`${ids}r`}>
                      Reference
                    </label>
                    <input
                      id={`${ids}r`}
                      className="bc-text"
                      defaultValue={part.ref}
                      key={part.ref}
                      disabled={readOnly}
                      onBlur={(e) => e.target.value !== part.ref && set({ ref: e.target.value }, "Change the reference")}
                    />
                    <label className="bc-field-label" htmlFor={`${ids}p`}>
                      Package
                    </label>
                    <select
                      id={`${ids}p`}
                      className="bc-select"
                      value={part.pkg}
                      disabled={readOnly || def.packages.length < 2}
                      onChange={(e) => set({ pkg: Number(e.target.value) }, "Change the package")}
                    >
                      {def.packages.map((p, i) => (
                        <option key={i} value={i}>
                          {p.footprint.name}
                        </option>
                      ))}
                      {def.packages.length === 0 && <option value={0}>No footprint</option>}
                    </select>
                    {def.packages.length > 0 && (
                      <Suspense fallback={null}>
                        <PartPreview def={def} pkg={part.pkg} />
                      </Suspense>
                    )}
                    <label className="bc-field-label" htmlFor={`${ids}l`}>
                      LCSC part number
                    </label>
                    <input
                      id={`${ids}l`}
                      className="bc-text"
                      value={part.supplier?.lcsc ?? def.supplier?.lcsc ?? ""}
                      placeholder="C25804"
                      disabled={readOnly}
                      onChange={(e) => set({ supplier: { ...part.supplier, lcsc: e.target.value.trim() || undefined } }, "Change the part number")}
                    />
                    <label className="bc-field-label" htmlFor={`${ids}m`}>
                      Maker's part number
                    </label>
                    <input
                      id={`${ids}m`}
                      className="bc-text"
                      value={part.supplier?.mpn ?? def.supplier?.mpn ?? ""}
                      disabled={readOnly}
                      onChange={(e) => set({ supplier: { ...part.supplier, mpn: e.target.value.trim() || undefined } }, "Change the part number")}
                    />
                    <label className="bc-ec-fitted">
                      <input
                        type="checkbox"
                        checked={part.fitted !== false}
                        disabled={readOnly}
                        onChange={(e) => set({ fitted: e.target.checked ? undefined : false }, e.target.checked ? "Fit the part" : "Leave the part off")}
                      />
                      Fitted
                    </label>
                    {part.fitted === false && (
                      <p className="bc-note">Stays on the schematic and the board, but is left off the parts list and assembly files.</p>
                    )}
                    {at && ui.view !== "pcb" && (
                      <dl className="bc-facts">
                        <dt>On the board</dt>
                        <dd>
                          X {at.x} mm, Y {at.y} mm, {at.rot}°, {at.side} side
                        </dd>
                      </dl>
                    )}
                    {ui.view === "pcb" && (
                      <Suspense fallback={null}>
                        <BoardProps design={design} edit={edit} readOnly={readOnly} part={part.id} selected={ui.selected} />
                      </Suspense>
                    )}
                  </>
                )}
                {def.source && (
                  <p className="bc-note">
                    From {def.source.library} · {def.source.licence}
                  </p>
                )}
              </>
            ),
          },
          ...(power
            ? []
            : [
                {
                  id: "ec-pins",
                  title: "Pins",
                  content: (
                    <dl className="bc-facts">
                      {nets.map(({ pin, net }) => (
                        <div key={pin.number} style={{ display: "contents" }}>
                          <dt>{pin.name && pin.name !== pin.number ? `${pin.number} ${pin.name}` : pin.number}</dt>
                          <dd>{net ?? (nl.noConnect.has(`${part.id}:${pin.number}`) ? "Left open" : "Not connected")}</dd>
                        </div>
                      ))}
                    </dl>
                  ),
                },
              ]),
        ]}
      />
    );
  }
  const size = design.board ? boardSize(design.board) : null;
  return (
    <PropsPanel
      sections={[
        {
          id: "ec-design",
          title: ui.selected.length > 1 ? `${ui.selected.length} selected` : "Electronics",
          content: (
            <>
              {ui.view === "pcb" && ui.selected.length > 0 ? (
                <Suspense fallback={null}>
                  <BoardProps design={design} edit={edit} readOnly={readOnly} selected={ui.selected} />
                </Suspense>
              ) : (
                <p className="bc-note">{ui.selected.length > 1 ? "Drag to move them together." : "Select a part to see its value, package and pins."}</p>
              )}
              <dl className="bc-facts">
                <dt>Parts</dt>
                <dd>{realParts(design).length}</dd>
                <dt>Nets</dt>
                <dd>{nl.nets.length}</dd>
                <dt>Board</dt>
                <dd>{size ? `${size.w} × ${size.h} mm, 2 layers` : "None yet"}</dd>
              </dl>
            </>
          ),
        },
      ]}
    />
  );
}
