import type { ElectronicsDesign, P2, Sheet } from "@bettercad/electronics";
import { clipOrigin, labelsNamed, localName, pasteOnSheet, setLabelShape } from "@bettercad/electronics";
import { groupsIn } from "@bettercad/electronics/groups";
import { ContextMenu, type MenuEntry } from "@bettercad/ui";
import { eactions, type EEdit } from "./actions";
import { getClip } from "./clip";
import type { LabelAsk } from "./SchematicCanvas";
import { schMenuRows, schMenuTitle, type SchMenuId } from "./schMenuRows";
import { eui } from "./ui";
import { toScreen, type View2D } from "./view2d";

export interface SchMenuProps {
  /** Where the menu opens on the page, and the place on the sheet it was opened on. */
  menu: { x: number; y: number; at: P2 };
  onClose: () => void;
  design: ElectronicsDesign;
  sheet: Sheet;
  selected: string[];
  readOnly: boolean;
  view: View2D;
  edit: EEdit;
  onAskLabel: (ask: LabelAsk | null) => void;
  startWire: (at: P2) => void;
  startBus: (at: P2) => void;
  askGroupName: (d: ElectronicsDesign, id: string) => void;
}

/** The schematic's right-click menu: loaded the first time it opens, to keep the workspace's own code small. */
export default function SchMenu(p: SchMenuProps) {
  const { design, sheet, view, edit, onAskLabel, readOnly } = p;
  const runMenu = (id: SchMenuId, at: P2) => {
    const ids = eui.get().selected;
    const one = ids.length === 1 ? ids[0]! : null;
    const label = one ? sheet.labels.find((l) => l.id === one) : undefined;
    const act = eactions.current;
    switch (id) {
      case "part":
        return eui.set({ card: "components" });
      case "wire":
        return p.startWire(at);
      case "bus":
        return p.startBus(at);
      case "label":
        return onAskLabel({ at, screen: toScreen(view, at) });
      case "text":
        return onAskLabel({ at, screen: toScreen(view, at), note: true });
      case "paste": {
        const clip = getClip();
        if (!clip || readOnly) return;
        const from = clipOrigin(clip);
        return edit((d) => {
          const pasted = pasteOnSheet(d, sheet.id, clip, at[0] - from[0], at[1] - from[1]);
          queueMicrotask(() => eui.set({ selected: pasted.ids }));
          return pasted.design;
        }, "Paste");
      }
      case "selectAll":
        return act?.selectAll();
      case "fit":
        return act?.fit();
      case "inspect":
        return eui.set({ inspect: eui.get().inspect + 1 });
      case "renameLabel":
        if (label) onAskLabel({ at: [label.x, label.y], screen: toScreen(view, [label.x, label.y]), id: label.id, name: localName(label.name, sheet) });
        return;
      case "ends": {
        if (!label) return;
        const all = labelsNamed(design, label.name);
        const here = all.filter((x) => x.sheet === sheet.id).map((x) => x.label.id);
        // All on this sheet: pick them all. Otherwise open the next sheet the name is on, with its labels picked.
        if (here.length > 1) return eui.set({ selected: here, focus: eui.get().focus + 1 });
        const there = all.find((x) => x.sheet !== sheet.id);
        if (there) eui.set({ sheet: there.sheet, selected: all.filter((x) => x.sheet === there.sheet).map((x) => x.label.id), focus: eui.get().focus + 1 });
        return;
      }
      case "shape:none":
      case "shape:in":
      case "shape:out":
      case "shape:both": {
        const shape = id === "shape:none" ? null : (id.slice(6) as "in" | "out" | "both");
        const picked = sheet.labels.filter((l) => ids.includes(l.id)).map((l) => l.id);
        return edit((d) => setLabelShape(d, sheet.id, picked, shape), shape ? "Label direction" : "Plain label");
      }
      case "port":
        return act?.port?.();
      case "renameBus": {
        const bus = sheet.buses?.find((b) => b.id === one);
        if (bus) onAskLabel({ at: bus.pts[0]!, screen: toScreen(view, bus.pts[0]!), id: bus.id, name: bus.name, bus: true });
        return;
      }
      case "openSheet": {
        const b = sheet.boxes?.find((x) => x.id === one);
        if (b) eui.set({ sheet: b.sheet, selected: [] });
        return;
      }
      case "group":
        return act?.group?.();
      case "ungroup":
        return act?.ungroup?.();
      case "renameGroup": {
        const g = groupsIn(sheet, ids)[0];
        if (g) p.askGroupName(design, g.id);
        return;
      }
      case "fold":
        return act?.fold?.();
      case "rotate":
        return act?.rotate();
      case "mirror":
        return act?.mirror();
      case "duplicate":
        return act?.duplicate?.();
      case "copy":
        return act?.copy?.();
      case "delete":
        return act?.remove();
    }
  };

  const entries = schMenuRows({ design, sheet, selected: p.selected, readOnly, canPaste: !!getClip() }).map((r): MenuEntry =>
    r.kind === "separator" || r.kind === "title" ? r : { ...r, onSelect: () => runMenu(r.id, p.menu.at) },
  );
  return <ContextMenu at={p.menu} onClose={p.onClose} label="Schematic actions" title={schMenuTitle({ sheet, selected: p.selected })} entries={entries} />;
}
