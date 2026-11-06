import { ArmedBar, Button, Separator, Toolbar, ViewCube } from "@bettercad/ui";
import { MODEL_TOOLS, VIEW_TOOLS, VIEWS, type Tool, type ToolId, type ViewId } from "./tools";

export interface StageProps {
  tool: Tool;
  onArmTool: (t: ToolId) => void;
  view: ViewId;
  onView: (v: ViewId) => void;
  onFit: () => void;
  partCount: number;
}

const toolButton = (t: Tool, active: ToolId, onArm: (t: ToolId) => void) => (
  <Button key={t.id} icon={t.icon} label={t.label} title={t.title} shortcut={t.key.toUpperCase()} on={active === t.id} onClick={() => onArm(t.id)} />
);

/** The middle column: floating tool bars, the viewport frame (empty until epic #3) and the help line. */
export function Stage({ tool, onArmTool, view, onView, onFit, partCount }: StageProps) {
  return (
    <main className="bc-stage" aria-label="Stage">
      <div className="bc-stage-bars">
        <Toolbar label="View tools">
          {VIEW_TOOLS.map((t) => toolButton(t, tool.id, onArmTool))}
          <Separator />
          {VIEWS.map((v) => (
            <Button
              key={v.id}
              label={v.label}
              title={`Look from the ${v.label.toLowerCase()}`}
              shortcut={v.key}
              on={view === v.id}
              onClick={() => onView(v.id)}
            />
          ))}
          <Separator />
          <Button icon="frame" label="Fit" title="Fit the parts in the view" shortcut="F" onClick={onFit} />
        </Toolbar>
        <Toolbar label="Model tools">{MODEL_TOOLS.map((t) => toolButton(t, tool.id, onArmTool))}</Toolbar>
        {tool.id !== "select" && (
          <ArmedBar title={tool.label} icon={tool.icon}>
            <span className="bc-armed-note">Coming with epic #{tool.epic}. Esc backs out.</span>
            <Button kind="cancel" label="Cancel" title="Put the tool down" shortcut="Esc" onClick={() => onArmTool("select")} />
          </ArmedBar>
        )}
      </div>
      <div
        className="bc-frame bc-viewport"
        tabIndex={0}
        role="application"
        aria-label={`3D view, ${VIEWS.find((v) => v.id === view)!.label} view, ${partCount} parts`}
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
      <p className="bc-help" aria-live="polite">
        {tool.help}
      </p>
    </main>
  );
}
