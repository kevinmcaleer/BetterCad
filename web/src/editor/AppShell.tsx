import type { ReactNode } from "react";
import { cx } from "@bettercad/ui";

export interface AppShellProps {
  topBar: ReactNode;
  /** The latest status message ("Added a box"), floating above the timeline. */
  status?: ReactNode;
  /** The open rail panel, or null when it is folded away. */
  leftPanel: ReactNode | null;
  leftLabel?: string;
  stageToolbar: ReactNode;
  /** The viewport. Epic #3 mounts the canvas here. */
  stage: ReactNode;
  /** The feature timeline along the bottom of the stage (epic #7). Left out when hidden from Settings. */
  timeline?: ReactNode;
  helpLine: ReactNode;
  rightPanel: ReactNode;
  /** Under 900px the props panel is a sheet over the stage, open only when asked for. */
  rightOpen?: boolean;
}

/**
 * The editor frame. The 3D view fills the whole window; the top bar, rail, panels, tool bars and timeline float
 * over it and never box it in. Later epics only fill the slots.
 * The tools sit on the top bar; the left panel is the browser, or the panel a top-bar button opened in its place.
 * Under 900px the tools float along the bottom and the panels become sheets over the view.
 */
export function AppShell({ topBar, status, leftPanel, leftLabel, stageToolbar, stage, timeline, helpLine, rightPanel, rightOpen }: AppShellProps) {
  return (
    <div className={cx("bc bc-app", !leftPanel && "bc-left-closed", rightOpen && "bc-right-open", !timeline && "bc-no-timeline")}>
      <a className="bc-skip" href="#bc-view">
        Skip to the 3D view
      </a>
      {topBar}
      <div className="bc-body">
        {leftPanel && (
          <aside className="bc-side bc-left" id="bc-left-panel" aria-label={leftLabel}>
            {leftPanel}
          </aside>
        )}
        <main className="bc-stage" aria-label="Stage">
          <div className="bc-stage-bars" data-floats="">
            {stageToolbar}
          </div>
          {stage}
          <div className="bc-stage-foot" data-floats="">
            {status && <div className="bc-status-pill">{status}</div>}
            {timeline}
            <div className="bc-help">{helpLine}</div>
          </div>
        </main>
        <div className="bc-right">{rightPanel}</div>
      </div>
    </div>
  );
}
