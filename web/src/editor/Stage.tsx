import { ArmedBar, Button, ToolButton, Toolbar, ViewCube } from "@bettercad/ui";
import { MODEL_TOOLS, VIEW_TOOLS, VIEWS, type Tool, type ToolId, type ViewId } from "./tools";

export interface StageBarsProps {
  tool: Tool;
  onArmTool: (t: ToolId) => void;
  view: ViewId;
  onView: (v: ViewId) => void;
  onFit: () => void;
}

const toolButton = (t: Tool, active: ToolId, onArm: (t: ToolId) => void) => (
  <ToolButton key={t.id} icon={t.icon} label={t.label} shortcut={t.key.toUpperCase()} pressed={active === t.id} showLabel onPress={() => onArm(t.id)} />
);

/** The floating tool bars over the viewport, and the armed tool's options strip. */
export function StageBars({ tool, onArmTool, view, onView, onFit }: StageBarsProps) {
  return (
    <>
      <Toolbar label="View tools">
        {VIEW_TOOLS.map((t) => toolButton(t, tool.id, onArmTool))}
        <Toolbar.Separator />
        {VIEWS.map((v) => (
          <Button
            key={v.id}
            label={v.label}
            title={`Look from the ${v.id === "iso" ? "corner" : v.label.toLowerCase()}`}
            shortcut={v.key}
            on={view === v.id}
            onClick={() => onView(v.id)}
          />
        ))}
        <Toolbar.Separator />
        <Button icon="frame" label="Fit" title="Fit the parts in the view" shortcut="F" onClick={onFit} />
      </Toolbar>
      <Toolbar label="Model tools">{MODEL_TOOLS.map((t) => toolButton(t, tool.id, onArmTool))}</Toolbar>
      {tool.id !== "select" && (
        <ArmedBar title={tool.label} icon={tool.icon}>
          <span className="bc-armed-note">Comes with epic #{tool.epic}. Esc puts it down.</span>
          <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={() => onArmTool("select")} />
        </ArmedBar>
      )}
    </>
  );
}

/** The viewport: an empty, focusable frame with the grid and view cube. Epic #3 mounts the three.js canvas here. */
export function Viewport({ view, onView, description }: { view: ViewId; onView: (v: ViewId) => void; description: string }) {
  return (
    <div
      id="bc-view"
      className="bc-frame bc-viewport"
      tabIndex={0}
      role="application"
      aria-label={`3D view, ${VIEWS.find((v) => v.id === view)!.label} view. ${description}`}
      aria-roledescription="3D view"
    >
      <svg className="bc-grid-svg" aria-hidden="true">
        <defs>
          <pattern id="bc-grid-minor" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" className="bc-grid" fill="none" />
          </pattern>
          <pattern id="bc-grid-major" width="200" height="200" patternUnits="userSpaceOnUse">
            <rect width="200" height="200" fill="url(#bc-grid-minor)" />
            <path d="M200 0H0V200" className="bc-grid-major" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bc-grid-major)" />
      </svg>
      <ViewCube onPick={(v) => onView(v === "right" ? "side" : v)} />
      <div className="bc-empty-view">
        <strong>The 3D view goes here</strong>
        <span>
          three.js arrives with epic #3. Everything around it works now: try the tools, the rail, ? for shortcuts, or{" "}
          {navigator.platform.includes("Mac") ? "⌘K" : "Ctrl+K"}.
        </span>
      </div>
    </div>
  );
}
