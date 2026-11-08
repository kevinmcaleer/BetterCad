import { ArmedBar, Button, MenuButton, NumberField, Toolbar } from "@bettercad/ui";
import { formatCombo } from "../state/commands";
import { VIEWS, type Tool, type ToolId } from "./tools";
import { FILTERS, type Viewport } from "./useViewport";

export interface StageBarsProps {
  tool: Tool;
  onArmTool: (t: ToolId) => void;
  vp: Viewport;
  /** Whether exactly one part is picked (Move and Turn need one). */
  onePart: boolean;
}

/** The view bar floating over the viewport (the tools live on the top bar), and the armed tool's options strip. */
export function StageBars({ tool, onArmTool, vp, onePart }: StageBarsProps) {
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
        {VIEWS.map((v) => (
          <Button
            key={v.id}
            label={v.label}
            title={`Look from the ${v.id === "iso" ? "corner" : v.label.toLowerCase()}`}
            shortcut={v.key}
            on={vp.view === v.id}
            onClick={() => vp.preset(v.id)}
          />
        ))}
        <Button icon="frame" label="Fit" title="Fit the parts in the view" shortcut="F" onClick={vp.fit} />
        <MenuButton label="Named views" entries={vp.viewEntries} trigger={(p) => <Button {...p} icon="camera" label="Views" title="Save and use views" />} />
        <Toolbar.Separator />
        <Button
          label={vp.ortho ? "Ortho" : "Persp"}
          title={vp.ortho ? "Orthographic: parallel lines stay parallel" : "Perspective: far things look smaller"}
          shortcut="O"
          on={vp.ortho}
          onClick={() => vp.setOrtho(!vp.ortho)}
        />
        <Button
          icon="paint"
          label={vp.style === "lineart" ? "Line art" : "Shaded"}
          title="Switch shaded and line art"
          shortcut="L"
          on={vp.style === "lineart"}
          onClick={vp.toggleStyle}
        />
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
