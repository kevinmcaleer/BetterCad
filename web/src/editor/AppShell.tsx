import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx, PropsHide } from "@bettercad/ui";
import { trackKeyboard } from "./keyboardInset";

export interface AppShellProps {
  topBar: ReactNode;
  /** The latest status message ("Added a box"), floating above the help line. */
  status?: ReactNode;
  /** Save notices: a toast at the top right of the view that fades out, so it never moves the timeline. */
  toast?: ReactNode;
  /** The open rail panel, or null when it is folded away. */
  leftPanel: ReactNode | null;
  leftLabel?: string;
  stageToolbar: ReactNode;
  /** The viewport. Epic #3 mounts the canvas here. */
  stage: ReactNode;
  /** The feature timeline, flush along the bottom edge (epic #7). Left out when hidden from Settings. */
  timeline?: ReactNode;
  helpLine: ReactNode;
  rightPanel: ReactNode;
  /** Under 900px the props panel is a sheet over the stage, open only when asked for. */
  rightOpen?: boolean;
  /** From 900px up the props panel can be put away: it folds up into the top bar's properties button. */
  rightHidden?: boolean;
  /** Puts the props panel away (wide) or closes its sheet (narrow); the panel shows a hide button when given. */
  onHideRight?: () => void;
}

/**
 * The editor frame. The 3D view fills the whole window; the top bar, rail, panels, tool bars and timeline float
 * over it and never box it in. Later epics only fill the slots.
 * The tools sit on the top bar; the left panel is the browser, or the panel a top-bar button opened in its place.
 * Under 900px the tools float along the bottom and the panels become sheets over the view.
 */
export function AppShell({
  topBar,
  status,
  toast,
  leftPanel,
  leftLabel,
  stageToolbar,
  stage,
  timeline,
  helpLine,
  rightPanel,
  rightOpen,
  rightHidden,
  onHideRight,
}: AppShellProps) {
  const appRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  // The bottom stack (status, help line, rolled-back warning, timeline) changes height as its parts come and go or
  // wrap. Publish its real height so --bc-view-bottom, and every tool dialog and overlay above it, clears it exactly.
  useLayoutEffect(() => {
    const foot = footRef.current!;
    const publish = () => appRef.current!.style.setProperty("--bc-foot-height", foot.offsetHeight + "px");
    publish();
    if (!window.ResizeObserver) return;
    const ro = new ResizeObserver(publish);
    ro.observe(foot);
    return () => ro.disconnect();
  }, []);
  // The props panel folds into, and grows back out of, the top bar's properties button: scaling about the button's
  // centre carries the card there, so you can see where it went.
  useLayoutEffect(() => {
    const right = rightRef.current!;
    const btn = appRef.current!.querySelector(".bc-props-toggle")?.getBoundingClientRect();
    const box = (right.offsetParent ?? document.body).getBoundingClientRect();
    if (!btn || !btn.width) return;
    const x = btn.left + btn.width / 2 - box.left - right.offsetLeft;
    const y = btn.top + btn.height / 2 - box.top - right.offsetTop;
    right.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`;
  }, [rightHidden]);
  // An on-screen keyboard (iPad, phones) covers the bottom of the window: the tool bars rise above it.
  useLayoutEffect(() => trackKeyboard(appRef.current!), []);
  return (
    <div
      ref={appRef}
      className={cx("bc bc-app", !leftPanel && "bc-left-closed", rightOpen && "bc-right-open", rightHidden && "bc-right-hidden", !timeline && "bc-no-timeline")}
    >
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
          {toast}
          <div className="bc-stage-foot" data-floats="" ref={footRef}>
            {status && <div className="bc-status-pill">{status}</div>}
            <div className="bc-help">{helpLine}</div>
            {timeline}
          </div>
        </main>
        <div className="bc-right" ref={rightRef}>
          <PropsHide.Provider value={onHideRight ?? null}>{rightPanel}</PropsHide.Provider>
        </div>
      </div>
    </div>
  );
}
