import type { ReactNode } from "react";
import { cx } from "@bettercad/ui";

export interface AppShellProps {
  topBar: ReactNode;
  rail: ReactNode;
  /** The open rail panel, or null when it is folded away. */
  leftPanel: ReactNode | null;
  leftLabel?: string;
  stageToolbar: ReactNode;
  /** The viewport. Epic #3 mounts the canvas here. */
  stage: ReactNode;
  helpLine: ReactNode;
  rightPanel: ReactNode;
  /** Under 900px the props panel is a sheet over the stage, open only when asked for. */
  rightOpen?: boolean;
}

/**
 * The editor frame: top bar, then rail | left panel | stage | props panel. Later epics only fill the slots.
 * Under 900px the rail moves to the bottom and the panels become sheets over the stage.
 */
export function AppShell({ topBar, rail, leftPanel, leftLabel, stageToolbar, stage, helpLine, rightPanel, rightOpen }: AppShellProps) {
  return (
    <div className={cx("bc bc-app", !leftPanel && "bc-left-closed", rightOpen && "bc-right-open")}>
      <a className="bc-skip" href="#bc-view">
        Skip to the 3D view
      </a>
      {topBar}
      <div className="bc-body">
        {rail}
        {leftPanel && (
          <aside className="bc-side bc-left" id="bc-left-panel" aria-label={leftLabel}>
            {leftPanel}
          </aside>
        )}
        <main className="bc-stage" aria-label="Stage">
          <div className="bc-stage-bars">{stageToolbar}</div>
          {stage}
          <div className="bc-help">{helpLine}</div>
        </main>
        {rightPanel}
      </div>
    </div>
  );
}
