import { labelsNamed, localName, type ElectronicsDesign, type LabelShape, type Sheet } from "@bettercad/electronics";
import { groupsIn } from "@bettercad/electronics/groups";

/**
 * The schematic's right-click menu (#788): what it offers for the thing under the pointer or the picked things, or
 * for an empty place on the sheet. Only the rows: the canvas runs each by its id.
 */

export type SchMenuId =
  | "part"
  | "wire"
  | "label"
  | "bus"
  | "text"
  | "paste"
  | "selectAll"
  | "fit"
  | "inspect"
  | "renameLabel"
  | "ends"
  | "shape:none"
  | "shape:in"
  | "shape:out"
  | "shape:both"
  | "port"
  | "renameBus"
  | "openSheet"
  | "group"
  | "ungroup"
  | "renameGroup"
  | "fold"
  | "rotate"
  | "mirror"
  | "duplicate"
  | "copy"
  | "delete";

export type SchMenuRow =
  | { kind?: "item"; id: SchMenuId; label: string; keys?: string; danger?: boolean; disabled?: boolean; checked?: boolean }
  | { kind: "separator"; id: string }
  | { kind: "title"; id: string; label: string };

export interface SchMenuInput {
  design: ElectronicsDesign;
  sheet: Sheet;
  /** The picked things' ids (the thing right-clicked is picked first). */
  selected: string[];
  readOnly: boolean;
  /** Something is on the clipboard to paste. */
  canPaste: boolean;
}

const SHAPES: [LabelShape | null, string][] = [
  [null, "No arrow"],
  ["in", "Comes in"],
  ["out", "Goes out"],
  ["both", "Both ways"],
];

/** The menu's heading: what it is about. */
export function schMenuTitle({ sheet, selected }: Pick<SchMenuInput, "sheet" | "selected">): string {
  if (!selected.length) return sheet.name;
  const groups = groupsIn(sheet, selected);
  const covered = new Set(groups.flatMap((g) => g.members));
  if (groups.length === 1 && selected.every((id) => covered.has(id))) return groups[0]!.name;
  if (selected.length > 1) return `${selected.length} things`;
  const id = selected[0];
  const label = sheet.labels.find((l) => l.id === id);
  if (label) return `Net label ${localName(label.name, sheet)}`;
  const bus = sheet.buses?.find((b) => b.id === id);
  if (bus) return `Bus ${bus.name}`;
  return "1 thing";
}

/** The rows of the menu. */
export function schMenuRows({ design, sheet, selected, readOnly, canPaste }: SchMenuInput): SchMenuRow[] {
  const sep = (id: string): SchMenuRow => ({ kind: "separator", id });
  if (!selected.length) {
    return [
      ...(readOnly
        ? []
        : ([
            { id: "part", label: "Place a part", keys: "P" },
            { id: "wire", label: "Start a wire here", keys: "W" },
            { id: "label", label: "Net label here", keys: "L" },
            { id: "bus", label: "Start a bus here", keys: "U" },
            { id: "text", label: "Text note here" },
            sep("s1"),
            { id: "paste", label: "Paste here", keys: "Ctrl+V", disabled: !canPaste },
          ] satisfies SchMenuRow[])),
      { id: "selectAll", label: "Select all", keys: "Ctrl+A" },
      { id: "fit", label: "Fit in the view", keys: "F" },
    ];
  }

  const rows: SchMenuRow[] = [];
  const picked = new Set(selected);
  const labels = sheet.labels.filter((l) => picked.has(l.id));
  const one = selected.length === 1 ? selected[0]! : null;
  const label = one ? labels[0] : undefined;
  if (label) {
    // The other ends of a net that is joined by name: labels with the same name, here or on other sheets.
    const others = labelsNamed(design, label.name).filter((x) => x.label.id !== label.id).length;
    if (!readOnly) rows.push({ id: "renameLabel", label: "Rename net label" });
    rows.push({
      id: "ends",
      label: others ? `Show the other ${others === 1 ? "end" : `${others} ends`}` : "No other label with this name yet",
      disabled: !others,
    });
  }
  if (labels.length && !readOnly) {
    rows.push({ kind: "title", id: "t-shape", label: "Signal direction" });
    const now = labels.every((l) => l.shape === labels[0]!.shape) ? (labels[0]!.shape ?? null) : undefined;
    for (const [shape, name] of SHAPES) rows.push({ id: `shape:${shape ?? "none"}` as SchMenuId, label: name, checked: now === shape });
    rows.push({ id: "port", label: labels.every((l) => l.port) ? "Make a plain label" : "Make a sheet pin" });
  }
  if (one && sheet.buses?.some((b) => b.id === one) && !readOnly) rows.push({ id: "renameBus", label: "Rename bus" });
  if (one && sheet.boxes?.some((b) => b.id === one)) rows.push({ id: "openSheet", label: "Open its sheet" });
  if (one && (sheet.symbols.some((s) => s.id === one) || sheet.wires.some((w) => w.id === one))) rows.push({ id: "inspect", label: "Properties" });
  if (readOnly) return [...rows, ...(rows.length ? [sep("s0")] : []), { id: "copy", label: "Copy", keys: "Ctrl+C" }];

  if (rows.length) rows.push(sep("s1"));
  const groups = groupsIn(sheet, selected);
  const covered = new Set(groups.flatMap((g) => g.members));
  const whole = groups.length > 0 && selected.every((id) => covered.has(id));
  if (!whole) rows.push({ id: "group", label: selected.length > 1 ? `Group these ${selected.length}` : "Group", keys: "Ctrl+G" });
  if (groups.length) {
    rows.push({ id: "ungroup", label: groups.length > 1 ? `Ungroup ${groups.length} groups` : "Ungroup", keys: "Shift+Ctrl+G" });
    if (groups.length === 1) rows.push({ id: "renameGroup", label: "Rename group" });
    const blocks = groups.filter((g) => g.block);
    if (blocks.length) rows.push({ id: "fold", label: blocks.every((g) => g.folded) ? "Unfold block" : "Fold block" });
  }
  rows.push(
    sep("s2"),
    { id: "rotate", label: "Rotate", keys: "R" },
    { id: "mirror", label: "Mirror", keys: "X" },
    { id: "duplicate", label: "Duplicate", keys: "Ctrl+D" },
    { id: "copy", label: "Copy", keys: "Ctrl+C" },
    sep("s3"),
    { id: "delete", label: "Delete", keys: "Del", danger: true },
  );
  return rows;
}
