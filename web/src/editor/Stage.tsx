import { lazy, Suspense } from "react";
import { ArmedBar, Button, MenuButton, NumberField, Toolbar, type MenuEntry } from "@bettercad/ui";
import { formatCombo } from "../state/commands";
import type { Tool, ToolId } from "./tools";
import { FILTERS, type Viewport } from "./useViewport";
import type { RenderStyle } from "../render/session";
import type { Say } from "./fullscreen";

const FullscreenButton = lazy(() => import("./fullscreen"));

export interface StageBarsProps {
  tool: Tool;
  onArmTool: (t: ToolId) => void;
  vp: Viewport;
  /** Whether exactly one part is picked (Move and Turn need one). */
  onePart: boolean;
  /** Opens the Render view (#197) in its colours or in paper white. */
  onRender?: (style: RenderStyle) => void;
  /** Shows the Full screen button (phones and tablets), with where it says why there is none. */
  say?: Say;
}

/** The view bar floating over the viewport (the tools live on the top bar), and the armed tool's options strip. */
export function StageBars({ tool, onArmTool, vp, onePart, onRender, say }: StageBarsProps) {
  const filter = FILTERS.find((f) => f.id === vp.filter)!;
  return (
    <>
      <Toolbar label="View tools">
        <MenuButton
          label="Pick filter"
          entries={vp.filterEntries}
          trigger={(p) => <Button {...p} label={`Pick: ${filter.label}`} title="What a click picks" shortcut={formatCombo(filter.key)} />}
        />
        <Toolbar.Separator />
        <Button icon="frame" label="Fit" title="Fit the parts in the view" shortcut="F" onClick={vp.fit} />
        <MenuButton label="Named views" entries={vp.viewEntries} trigger={(p) => <Button {...p} icon="camera" label="Views" title="Save and use views" />} />
        <MenuButton
          label="View style"
          entries={[
            { id: "shaded", label: "Shaded", checked: vp.style === "shaded", onSelect: () => vp.setStyle("shaded") },
            { id: "lineart", label: "Line art", keys: "L", checked: vp.style === "lineart", onSelect: () => vp.setStyle("lineart") },
            { kind: "separator", id: "grid-sep" },
            { id: "grid", label: "Floor grid", checked: vp.grid, multiple: true, onSelect: vp.toggleGrid },
            ...(onRender
              ? ([
                  { kind: "separator", id: "render-sep" },
                  { id: "render", label: "Render", icon: "sun", keys: formatCombo("shift+r"), onSelect: () => onRender("finishes") },
                  { id: "paper", label: "Render in paper", icon: "sun", onSelect: () => onRender("paper") },
                ] as MenuEntry[])
              : []),
          ]}
          trigger={(p) => (
            <Button {...p} icon="paint" label={vp.style === "lineart" ? "Line art" : "Shaded"} title="How the view draws the model, or a rendered picture" />
          )}
        />
        {say && (
          <Suspense fallback={null}>
            <FullscreenButton say={say} />
          </Suspense>
        )}
      </Toolbar>
      {tool.id === "section" && (
        <ArmedBar title={tool.label} icon={tool.icon}>
          {vp.section ? (
            <>
              <NumberField
                label="Offset"
                value={vp.section.offset}
                step={1}
                onChange={(v) => vp.setSection({ ...vp.section!, offset: v })}
                onCommit={(v) => vp.setSection({ ...vp.section!, offset: v })}
              />
              <Button
                label="Flip"
                title="Keep the other side"
                onClick={() => {
                  const s = vp.section!;
                  vp.setSection({ ...s, normal: [-s.normal[0], -s.normal[1], -s.normal[2]], offset: -s.offset });
                }}
              />
              <Button label="Clear" title="Remove the cut" onClick={() => vp.setSection(null)} />
            </>
          ) : (
            <span className="bc-armed-note">Click a face to cut through it.</span>
          )}
          <Button kind="done" label="Done" title="Keep the cut and put the tool down" shortcut="Esc" onClick={() => onArmTool("select")} />
        </ArmedBar>
      )}
      {(tool.id === "move" || tool.id === "turn") && (
        <ArmedBar title={tool.label} icon={tool.icon}>
          <span className="bc-armed-note">
            {onePart ? "Drag a handle. Hold Shift to snap." : "Click one part to put the handles on it."} Esc puts the tool down.
          </span>
          <Button kind="cancel" label="Done" title="Put the tool down" shortcut="Esc" onClick={() => onArmTool("select")} />
        </ArmedBar>
      )}
      {tool.id !== "select" && tool.epic && (
        <ArmedBar title={tool.label} icon={tool.icon}>
          <span className="bc-armed-note">Comes with epic #{tool.epic}. Esc puts it down.</span>
          <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={() => onArmTool("select")} />
        </ArmedBar>
      )}
    </>
  );
}
