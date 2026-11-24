import { ArmedBar, Button, NumberField } from "@bettercad/ui";
import type { Tool, ToolId } from "./tools";
import type { Viewport } from "./useViewport";

export interface StageBarsProps {
  tool: Tool;
  onArmTool: (t: ToolId) => void;
  vp: Viewport;
  /** Whether exactly one part is picked (Move and Turn need one). */
  onePart: boolean;
}

/**
 * The armed tool's options strip. There is no view bar: Fit and Go home sit by the view cube, the pick filter and
 * display options are in the view menu (the cube's arrow, or a right-click in empty space), and named views are in
 * the browser.
 */
export function StageBars({ tool, onArmTool, vp, onePart }: StageBarsProps) {
  return (
    <>
      {tool.id === "section" && (
        <ArmedBar title={vp.editingSection ? `${tool.label}: ${vp.editingSection.name}` : tool.label} icon={tool.icon}>
          {vp.editingSection ? (
            <>
              <NumberField
                label="Offset"
                value={vp.editingSection.offset}
                step={1}
                onChange={(v) => vp.sections.save({ ...vp.editingSection!, offset: v })}
                onCommit={(v) => vp.sections.save({ ...vp.editingSection!, offset: v })}
              />
              <Button
                label="Flip"
                title="Keep the other side"
                onClick={() => {
                  const s = vp.editingSection!;
                  vp.sections.save({ ...s, normal: [-s.normal[0], -s.normal[1], -s.normal[2]], offset: -s.offset });
                }}
              />
              <Button label="Delete" title="Delete this section analysis" onClick={() => vp.sections.remove(vp.editingSection!.id)} />
            </>
          ) : (
            <span className="bc-armed-note">Click a face to add a section.</span>
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
