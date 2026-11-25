import { useEffect, useRef, useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import type { RouteProgress } from "@bettercad/electronics/pcb/autoroute";
import { applyRoutes, type Route } from "@bettercad/electronics/pcb/route";
import { Button, ESC, FeaturePanel, FeatureRow, PanelNote, useEscape } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { startRouting, type RouteJob } from "./autorouteJob";
import { useEui } from "./useEui";

type Sides = "both" | "top" | "bottom";
type What = "all" | "parts" | "net";

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const connections = (n: number) => `${n} ${n === 1 ? "connection" : "connections"}`;

/**
 * Autoroute (#647): lays tracks for the connections still to make, in a worker, with how far it has got and a
 * Stop. What it lays goes on the board as one step, so one undo takes it all out. It never moves a track or via that
 * is already there.
 */
export default function AutoRoute({ design, edit, readOnly, onClose }: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean; onClose: () => void }) {
  const ui = useEui();
  const [what, setWhat] = useState<What>("all");
  const [sides, setSides] = useState<Sides>("both");
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [said, setSaid] = useState("");
  const job = useRef<{ job: RouteJob; design: ElectronicsDesign; routes: Route[]; last: RouteProgress | null; lost: Set<string> } | null>(null);
  const now = useRef(design);
  now.current = design;

  const onBoard = new Set(design.board?.placements.map((p) => p.part));
  const parts = ui.selected.filter((id) => onBoard.has(id));
  const scope: What = what === "parts" && !parts.length ? "all" : what === "net" && !ui.net ? "all" : what;
  const left = ui.unrouted ?? 0;

  /** Lays what was found, as one step, and says how it went. */
  const finish = (stopped: boolean) => {
    const run = job.current;
    job.current = null;
    setProgress(null);
    if (!run) return;
    const { routes, last } = run;
    if (routes.length && now.current !== run.design) return setSaid("The board changed while it was routing, so nothing was laid. Route again.");
    const lay = routes;
    if (lay.length) edit((d) => applyRoutes(d, lay), "Autoroute");
    const lost = [...run.lost];
    const tried = last?.done ?? 0;
    const total = last?.total ?? 0;
    setSaid(
      [
        !tried
          ? stopped
            ? "Stopped before anything was routed."
            : "There was nothing to route."
          : `Routed ${lay.length} of ${connections(stopped ? tried : total)}.`,
        stopped && tried < total ? `Stopped with ${total - tried} still to try.` : "",
        lost.length ? `No way was found for ${list(lost)}. Route ${lost.length === 1 ? "it" : "them"} by hand, or move the parts apart and try again.` : "",
        lay.length ? "Undo takes the new tracks out in one step." : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const start = () => {
    setSaid("");
    const run = { design, routes: [] as Route[], last: null as RouteProgress | null, lost: new Set<string>(), job: null as unknown as RouteJob };
    job.current = run;
    setProgress({ done: 0, total: left, routed: 0, failed: 0, net: "" });
    run.job = startRouting(
      design,
      {
        ...(scope === "parts" ? { parts } : {}),
        ...(scope === "net" && ui.net ? { nets: [ui.net] } : {}),
        ...(sides === "both" ? {} : { layers: [sides] }),
      },
      {
        progress: (p) => {
          if (job.current !== run) return;
          if (p.route) {
            run.routes.push(p.route);
            run.lost.delete(p.net);
          } else run.lost.add(p.net);
          run.last = p;
          setProgress(p);
        },
        done: () => job.current === run && finish(false),
        fail: () => {
          if (job.current !== run) return;
          job.current = null;
          setProgress(null);
          setSaid("The router could not run. Try again.");
        },
      },
    );
  };

  const stop = () => {
    job.current?.job.stop();
    finish(true);
  };
  // Closing the card while it works stops it and keeps what it found.
  const close = () => {
    if (job.current) stop();
    onClose();
  };
  useEscape(true, close, ESC.panel);
  useEffect(() => () => job.current?.job.stop(), []);

  const busy = !!progress;
  return (
    <FeaturePanel title="Autoroute" icon="route" className="bc-ec-card bc-ec-setup" cancel={{ label: "Close", title: "Close", onClick: close }}>
      <PanelNote>
        Lays tracks for the connections still to make, the short ones first. Tracks already on the board stay where they are. Best for simple boards and for
        finishing off.
      </PanelNote>
      <fieldset className="bc-ec-set" disabled={readOnly || busy}>
        <FeatureRow label="Route">
          <select className="bc-select" aria-label="What to route" value={scope} onChange={(e) => setWhat(e.target.value as What)}>
            <option value="all">Every connection left</option>
            {parts.length > 0 && <option value="parts">{parts.length === 1 ? "The picked part" : `The ${parts.length} picked parts`}</option>}
            {ui.net && <option value="net">Only {ui.net}</option>}
          </select>
        </FeatureRow>
        <FeatureRow label="Sides">
          <select className="bc-select" aria-label="Sides to route on" value={sides} onChange={(e) => setSides(e.target.value as Sides)}>
            <option value="both">Both sides</option>
            <option value="top">Top only</option>
            <option value="bottom">Bottom only</option>
          </select>
        </FeatureRow>
      </fieldset>
      {busy ? (
        <>
          <progress className="bc-progress" aria-label="Routing" max={Math.max(1, progress.total)} value={progress.done} />
          <PanelNote live>
            {progress.done ? `Tried ${progress.done} of ${connections(progress.total)}, routed ${progress.routed}.` : "Reading the board."}
          </PanelNote>
          <Button variant="secondary" icon="stop" label="Stop" title="Stop, and keep what is routed so far" onClick={stop} />
        </>
      ) : (
        <>
          <PanelNote live>{said || (left ? `${connections(left)} still to route on the board.` : "Every connection on the board is routed.")}</PanelNote>
          <Button variant="primary" icon="route" label="Route" title="Start routing" disabled={readOnly || !left} onClick={start} />
        </>
      )}
    </FeaturePanel>
  );
}
