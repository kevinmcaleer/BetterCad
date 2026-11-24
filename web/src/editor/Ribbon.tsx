import { useState, useSyncExternalStore } from "react";
import { Icon, MenuButton, RibbonButton, RibbonGroup, type IconName, type MenuEntry } from "@bettercad/ui";
import type { Registry } from "../state/commands";
import { formatCombo } from "../state/commands";
import type { ToolId } from "./tools";
import type { PanelId } from "./LeftPanel";
import { pinnedTools, setPinnedTools, type RibbonTab } from "./ribbonPrefs";

/** A tool on the ribbon: a command, with a shorter name under its icon and its own colour icon where it needs one. */
export interface Item {
  id: string;
  short?: string;
  colour?: string;
}
export interface Group {
  id: string;
  label: string;
  /** The drop-down's sections: a title (or none) and the tools under it. */
  sections: [string, (Item | string)[]][];
  /** Shown big on the ribbon until you pin others. */
  pins: string[];
}

const ARRANGE: Group = {
  id: "arrange",
  label: "Arrange",
  sections: [["", ["tool.select", "tool.move", "tool.turn", "edit.group"]]],
  pins: ["tool.select", "tool.move", "tool.turn"],
};

/** Every tab's groups, ranked by how often they are used, as the top bar's TOOL_GROUPS. */
export const RIBBON: Record<Exclude<RibbonTab, "sketch">, Group[]> = {
  model: [
    ARRANGE,
    {
      id: "create",
      label: "Create",
      sections: [
        ["Sketch", ["tool.sketch"]],
        ["Solid from a sketch", ["tool.extrude", "tool.revolve", "tool.loft", "tool.sweep"]],
      ],
      pins: ["tool.sketch", "tool.extrude", "tool.revolve", "tool.loft"],
    },
    {
      id: "modify",
      label: "Modify",
      sections: [
        ["Faces", [{ id: "tool.pushpull", short: "Push/pull" }, { id: "tool.offsetFace", short: "Offset" }, "tool.decal"]],
        ["Edges", ["tool.fillet"]],
        ["Bodies", ["tool.shell", "tool.hole", "tool.combine", { id: "tool.split", short: "Split" }]],
      ],
      pins: ["tool.pushpull", "tool.fillet", "tool.shell", "tool.combine"],
    },
    { id: "copy", label: "Copy", sections: [["", ["tool.pattern", "tool.mirror"]]], pins: ["tool.pattern", "tool.mirror"] },
    { id: "construct", label: "Construct", sections: [["", ["construct.*"]]], pins: ["construct.offset"] },
    {
      id: "insert",
      label: "Insert",
      sections: [
        [
          "Parts",
          ["panel.library", { id: "model.insert", short: "Model" }, { id: "file.insert", short: "File" }, "panel.catalogue", "tool.gear", "tool.mount"],
        ],
        ["Files", ["file.import", "file.importReference", "tool.canvas"]],
      ],
      pins: ["panel.library", "file.insert", "tool.gear"],
    },
    {
      id: "inspect",
      label: "Inspect",
      sections: [["", ["tool.measure", "tool.section", { id: "check.clashes", short: "Clashes", colour: "clash" }, { id: "view.render", colour: "camera" }]]],
      pins: ["tool.measure", "tool.section"],
    },
  ],
  assemble: [
    ARRANGE,
    {
      id: "components",
      label: "Components",
      sections: [
        [
          "",
          [
            { id: "link.make", short: "Component" },
            { id: "model.insert", short: "Insert" },
            { id: "file.insert", short: "Insert file" },
            "tool.joint",
            { id: "rigid.make", colour: "link" },
            "link.select",
          ],
        ],
      ],
      pins: ["link.make", "model.insert", "tool.joint", "rigid.make"],
    },
    {
      id: "motion",
      label: "Motion",
      sections: [["", ["pose.save", "pose.tool", "drive.add", "drive.together"]]],
      pins: ["pose.save", "drive.add"],
    },
    {
      id: "check",
      label: "Check",
      sections: [
        [
          "",
          [
            { id: "check.clashes", short: "Clashes", colour: "clash" },
            { id: "check.sweep", short: "Sweep" },
          ],
        ],
      ],
      pins: ["check.clashes", "check.sweep"],
    },
  ],
  inspect: [
    { id: "measure", label: "Measure", sections: [["", ["tool.measure"]]], pins: ["tool.measure"] },
    { id: "section", label: "Section", sections: [["", ["tool.section", "view.clearSection"]]], pins: ["tool.section"] },
    {
      id: "print",
      label: "Print",
      sections: [
        [
          "",
          [
            { id: "print.overhangs", short: "Overhangs" },
            { id: "print.thin", short: "Thin walls" },
          ],
        ],
      ],
      pins: ["print.overhangs", "print.thin"],
    },
    {
      id: "check",
      label: "Check",
      sections: [
        [
          "",
          [
            { id: "check.clashes", short: "Clashes", colour: "clash" },
            { id: "check.sweep", short: "Sweep" },
          ],
        ],
      ],
      pins: ["check.clashes"],
    },
    {
      id: "show",
      label: "Show",
      sections: [["", [{ id: "view.render", colour: "camera" }]]],
      pins: ["view.render"],
    },
  ],
  // The model's drawings (#555). Inside a drawing its own Drawing tab takes over, as Sketch does.
  drawing: [
    {
      id: "create",
      label: "Create",
      sections: [
        [
          "",
          [
            { id: "drawing.new", short: "New drawing", colour: "drawing" },
            { id: "drawing.everyPart", short: "Every part", colour: "drawingEvery" },
          ],
        ],
      ],
      pins: ["drawing.new", "drawing.everyPart"],
    },
  ],
  // Choosing the tab opens the Render view, whose own tools (RenderRibbon) take over.
  render: [],
  // The electronics workspace (#606). Inside a view the tab shows that view's tools instead.
  electronics: [
    {
      id: "design",
      label: "Design",
      sections: [
        [
          "",
          [
            { id: "electronics.schematic", short: "Schematic", colour: "schematic" },
            { id: "electronics.pcb", short: "PCB", colour: "pcb" },
          ],
        ],
      ],
      pins: ["electronics.schematic", "electronics.pcb"],
    },
  ],
};

export const SHORT: Record<string, string> = { "construct.offset": "Plane", "panel.library": "Library", "tool.measure": "Measure" };
const item = (x: Item | string): Item => (typeof x === "string" ? { id: x } : x);

/** A section's tools that the registry knows, with "construct.*" opened out to every Construct command. */
export function sectionItems(list: (Item | string)[], registry: Registry): Item[] {
  return list
    .flatMap((x): Item[] =>
      x === "construct.*"
        ? registry
            .list()
            .filter((c) => c.id.startsWith("construct."))
            .map((c) => ({ id: c.id }))
        : [item(x)],
    )
    .filter((it) => registry.get(it.id));
}

export interface RibbonToolsProps {
  tab: Exclude<RibbonTab, "sketch">;
  registry: Registry;
  tool: ToolId;
  mirrorOn?: boolean;
  panel: PanelId | null;
  /** The model's drawings, for the Drawing tab's Open group. */
  drawings?: { id: string; name: string }[];
  onOpenDrawing?: (id: string) => void;
}

/** A ribbon tool shows pressed while its tool is armed or its panel is open. */
export function isPressed(id: string, tool: ToolId, mirrorOn: boolean | undefined, panel: PanelId | null): boolean {
  return id === "tool.mirror"
    ? !!mirrorOn
    : id === "panel.library"
      ? panel === "library"
      : id === "panel.catalogue"
        ? panel === "robot"
        : id === `tool.${tool}` && !(id === "tool.pattern" && mirrorOn);
}

/** The ribbon's second row: the open tab's groups, each with its pinned tools big and a drop-down of all of them. */
export function RibbonTools({ tab, registry, tool, mirrorOn, panel, drawings, onOpenDrawing }: RibbonToolsProps) {
  useSyncExternalStore(registry.subscribe, registry.version);
  const [pins, setPins] = useState(pinnedTools);
  const pressed = (id: string) => isPressed(id, tool, mirrorOn, panel);
  const togglePin = (g: Group, id: string) => {
    const now = pins[`${tab}.${g.id}`] ?? g.pins;
    const next = { ...pins, [`${tab}.${g.id}`]: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] };
    setPins(next);
    setPinnedTools(next);
  };
  return (
    <>
      {RIBBON[tab].map((g) => {
        const saved = pins[`${tab}.${g.id}`] ?? g.pins;
        const all = new Map<string, Item>();
        const entries: MenuEntry[] = [];
        for (const [title, list] of g.sections) {
          const known = sectionItems(list, registry);
          if (!known.length) continue;
          if (title) entries.push({ kind: "title", id: `t-${title}`, label: title });
          for (const it of known) {
            const c = registry.get(it.id)!;
            all.set(it.id, it);
            entries.push({
              id: it.id,
              label: c.label,
              icon: c.icon as IconName | undefined,
              colour: it.colour ?? true,
              keys: c.keys?.[0] && formatCombo(c.keys[0]),
              disabled: !registry.enabled(it.id),
              pin: { on: saved.includes(it.id), onToggle: () => togglePin(g, it.id) },
              onSelect: () => registry.run(it.id),
            });
          }
        }
        // Pins saved before a tool moved to another group stay behind; show only this group's tools.
        const shown = saved.filter((id) => all.has(id));
        return (
          <RibbonGroup key={g.id} label={g.label} entries={entries}>
            {shown.map((id) => {
              const c = registry.get(id);
              if (!c) return null;
              const it = all.get(id) ?? { id };
              return (
                <RibbonButton
                  key={id}
                  icon={(c.icon ?? "more") as IconName}
                  colour={it.colour ?? true}
                  label={c.label}
                  short={it.short ?? SHORT[id]}
                  shortcut={c.keys?.[0] && formatCombo(c.keys[0])}
                  pressed={pressed(id)}
                  disabled={!registry.enabled(id)}
                  onPress={() => registry.run(id)}
                />
              );
            })}
          </RibbonGroup>
        );
      })}
      {tab === "drawing" && onOpenDrawing && <OpenDrawing drawings={drawings ?? []} onOpen={onOpenDrawing} />}
    </>
  );
}

/** The Drawing tab's Open group: a button listing the model's drawings, and the same list from the group's name. */
function OpenDrawing({ drawings, onOpen }: { drawings: { id: string; name: string }[]; onOpen: (id: string) => void }) {
  const entries: MenuEntry[] = drawings.map((d) => ({ id: d.id, label: d.name, icon: "drawing", onSelect: () => onOpen(d.id) }));
  const none = !drawings.length;
  return (
    <RibbonGroup label="Open" entries={entries}>
      {none ? (
        <RibbonButton icon="folder" colour="drawingOpen" label="Open drawing: this model has none yet" short="Open" disabled />
      ) : (
        <MenuButton
          label="Drawings in this model"
          entries={entries}
          trigger={(t) => (
            <button {...t} type="button" className="bc-rb" aria-label="Open drawing" data-tip="Open drawing">
              <Icon name="folder" size={28} colour="drawingOpen" />
              <span className="bc-rb-label">Open</span>
            </button>
          )}
        />
      )}
    </RibbonGroup>
  );
}
