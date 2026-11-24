import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  boardPads,
  categoriesOf,
  emptyDesign,
  footprintBox,
  inflate,
  placePart,
  pushToBoard,
  searchPack,
  type ComponentDef,
  type LibraryPack,
  type PackPart,
} from "@bettercad/electronics";
import { ESC, FeaturePanel, Icon, PanelNote, cx, useEscape } from "@bettercad/ui";
import { readColours } from "./colours";
import { drawBoard } from "./drawBoard";
import { drawSymbol } from "./drawSchematic";
import { symbolBox } from "./hit";
import { noteRecent, recentParts, starredParts, toggleStar } from "./partPrefs";
import { basicsPack, loadStarter } from "./starter";
import { eui } from "./ui";
import { fit } from "./view2d";

/** How many results the list draws at once. More than this and typing another word is quicker than scrolling. */
const SHOWN = 60;

function canvasFor(el: HTMLCanvasElement | null): { ctx: CanvasRenderingContext2D; size: { w: number; h: number } } | null {
  if (!el) return null;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w < 4 || h < 4) return null;
  const ratio = window.devicePixelRatio || 1;
  el.width = Math.round(w * ratio);
  el.height = Math.round(h * ratio);
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, size: { w, h } };
}

/** The symbol and the footprint of a part, side by side, drawn the way the views draw them. */
export function PartPreview({ def, pkg }: { def: ComponentDef; pkg: number }) {
  const sym = useRef<HTMLCanvasElement>(null);
  const fp = useRef<HTMLCanvasElement>(null);
  const choice = def.packages[pkg] ?? def.packages[0];
  useEffect(() => {
    const colours = readColours(sym.current);
    const s = canvasFor(sym.current);
    if (s) {
      const view = fit(symbolBox(def.symbol), s.size, undefined, 10);
      drawSymbol(s.ctx, { ...view, scale: Math.min(view.scale, 12) }, def.symbol, { x: 0, y: 0, rot: 0 }, colours, {});
    }
    const f = canvasFor(fp.current);
    if (f && choice) {
      // A one-part board, so the footprint is drawn by the same code as the PCB view.
      const one = placePart(emptyDesign(), "sh1", def, { x: 0, y: 0 }, { pkg });
      const made = pushToBoard(one.design).design;
      if (!made.board) return;
      const box = footprintBox(choice.footprint);
      const far = 1e4;
      const design = {
        ...made,
        board: {
          ...made.board,
          outline: [
            { x: -far, y: -far },
            { x: far, y: -far },
            { x: far, y: far },
            { x: -far, y: far },
          ],
          placements: made.board.placements.map((p) => ({ ...p, x: 0, y: 0, rot: 0 })),
        },
      };
      const view = fit(box, f.size, undefined, 10);
      drawBoard(f.ctx, { ...view, scale: Math.min(view.scale, 40) }, f.size, design, colours, {
        selected: new Set(),
        hidden: new Set(["edge", "ratsnest"]),
        active: "top",
        pads: boardPads(design),
        air: [],
      });
    }
  }, [def, pkg, choice]);
  return (
    <div className="bc-ec-preview">
      <figure>
        <canvas ref={sym} role="img" aria-label={`Symbol of ${def.name}`} />
        <figcaption>Symbol</figcaption>
      </figure>
      {choice && (
        <figure>
          <canvas ref={fp} role="img" aria-label={`Footprint ${choice.footprint.name}`} />
          <figcaption>Footprint</figcaption>
        </figure>
      )}
    </div>
  );
}

/** A plain line about a part's body, until the 3D view of a part comes with the 3D board. */
function bodyText(def: ComponentDef, pkg: number): string | null {
  const s = def.packages[pkg]?.model?.source;
  if (!s) return null;
  if (s.kind === "box") return `Body: a box, ${s.size.join(" × ")} mm`;
  if (s.kind === "cylinder") return `Body: a cylinder, ${s.diameter} mm across, ${s.height} mm tall`;
  if (s.kind === "header") return `Body: ${s.rows} × ${s.pins} pins at ${s.pitch} mm`;
  return "Body: a 3D model";
}

const labelOf = (p: PackPart, i = 0) => p.packages[i]?.label ?? p.packages[i]?.footprint ?? "";

/**
 * The Components panel (#625): find a part in the starter library by name, value, package or keyword, look at its
 * symbol and footprint, pick the package, then place it. Parts you starred and parts you placed lately sit on top.
 */
export function ComponentsCard({ onClose }: { onClose: () => void }) {
  const [pack, setPack] = useState<LibraryPack | null>(null);
  const [failed, setFailed] = useState(false);
  const [find, setFind] = useState("");
  const [shelf, setShelf] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [pkg, setPkg] = useState(0);
  const [recent, setRecent] = useState(recentParts);
  const [starred, setStarred] = useState(starredParts);
  const field = useId();
  const shelfId = useId();
  const pkgId = useId();

  useEffect(() => {
    let live = true;
    loadStarter().then(
      (p) => live && setPack(p),
      () => {
        if (!live) return;
        setFailed(true);
        setPack(basicsPack());
      },
    );
    return () => {
      live = false;
    };
  }, []);
  useEscape(true, onClose, ESC.panel);

  const found = useMemo(() => (pack ? searchPack(pack, find, shelf || undefined) : []), [pack, find, shelf]);
  const byId = useMemo(() => new Map(pack?.parts.map((p) => [p.id, p]) ?? []), [pack]);
  const browsing = !find.trim() && !shelf;
  const kept = (ids: string[]) => ids.flatMap((id) => byId.get(id) ?? []);
  const part = chosen ? byId.get(chosen) : undefined;
  const def = useMemo(() => (pack && part ? inflate(pack, part) : null), [pack, part]);

  // The part's card sits under the list: bring it into view when a part is picked.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (chosen) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [chosen]);

  const choose = (p: PackPart) => {
    setChosen(p.id);
    setPkg(0);
  };
  const place = (p = part, at = pkg) => {
    if (!pack || !p) return;
    setRecent(noteRecent(p.id));
    eui.set({ placing: inflate(pack, p), placingPkg: at, schTool: "place", card: null, selected: [] });
  };

  const row = (p: PackPart, list: string) => (
    <li key={`${list}-${p.id}`}>
      <button
        type="button"
        className={cx("bc-ec-part", chosen === p.id && "bc-on")}
        aria-pressed={chosen === p.id}
        aria-label={`${p.name} (${p.packages.length ? labelOf(p) : "Power"})`}
        onClick={() => choose(p)}
        onDoubleClick={() => place(p, 0)}
      >
        <Icon name={p.packages.length ? "chip" : "powerSymbol"} size={16} />
        <span>{p.name}</span>
        <small>{p.packages.length ? labelOf(p) : "Power"}</small>
      </button>
    </li>
  );

  return (
    <FeaturePanel
      title="Components"
      icon="chip"
      className="bc-ec-card bc-ec-components"
      cancel={{ label: "Close", title: "Close (Esc)", onClick: onClose }}
      {...(part ? { ok: { label: "Place", title: `Place ${part.name} on the sheet`, onClick: () => place() } } : {})}
    >
      <label className="bc-field-label" htmlFor={field}>
        Find a part
      </label>
      <input
        id={field}
        className="bc-text"
        type="search"
        value={find}
        autoFocus
        onChange={(e) => setFind(e.target.value)}
        placeholder="Resistor, 0603, Pico, GND"
      />
      <label className="bc-field-label" htmlFor={shelfId}>
        Shelf
      </label>
      <select id={shelfId} className="bc-select" value={shelf} onChange={(e) => setShelf(e.target.value)}>
        <option value="">All parts</option>
        {pack && categoriesOf(pack).map((c) => <option key={c}>{c}</option>)}
      </select>
      {!pack && (
        <p className="bc-note" role="status">
          Fetching the parts library.
        </p>
      )}
      {failed && <PanelNote>The parts library did not load, so these are the basics. Close this and open it again to retry.</PanelNote>}
      {pack && browsing && kept(starred).length > 0 && (
        <ul className="bc-ec-parts bc-ec-parts-short" aria-label="Starred parts">
          {kept(starred).map((p) => row(p, "star"))}
        </ul>
      )}
      {pack && browsing && kept(recent).length > 0 && (
        <ul className="bc-ec-parts bc-ec-parts-short" aria-label="Parts you placed lately">
          {kept(recent).map((p) => row(p, "recent"))}
        </ul>
      )}
      {pack && (
        <ul className="bc-ec-parts" aria-label="Parts">
          {found.slice(0, SHOWN).map((p) => row(p, "all"))}
          {found.length === 0 && <li className="bc-note">Nothing matches. Try a shorter word.</li>}
          {found.length > SHOWN && (
            <li className="bc-note">
              Showing {SHOWN} of {found.length}. Type a word or pick a shelf to narrow it.
            </li>
          )}
        </ul>
      )}
      {part && def ? (
        <section ref={cardRef} className="bc-ec-part-card" aria-label={part.name}>
          <header>
            <h3>{part.name}</h3>
            <button
              type="button"
              className="bc-ec-star"
              aria-pressed={starred.includes(part.id)}
              aria-label={`Star ${part.name}`}
              data-tip={starred.includes(part.id) ? "Take off your starred parts" : "Keep at the top of the list"}
              onClick={() => setStarred(toggleStar(part.id))}
            >
              <Icon name="star" size={16} />
            </button>
          </header>
          {part.description && <p className="bc-note">{part.description}</p>}
          <PartPreview def={def} pkg={pkg} />
          {part.packages.length > 1 && (
            <>
              <label className="bc-field-label" htmlFor={pkgId}>
                Package
              </label>
              <select id={pkgId} className="bc-select" value={pkg} onChange={(e) => setPkg(Number(e.target.value))}>
                {part.packages.map((_, i) => (
                  <option key={i} value={i}>
                    {labelOf(part, i)}
                  </option>
                ))}
              </select>
            </>
          )}
          {bodyText(def, pkg) && <p className="bc-note">{bodyText(def, pkg)}</p>}
          {def.source && (
            <p className="bc-note">
              From{" "}
              {def.source.url ? (
                <a href={def.source.url} target="_blank" rel="noreferrer">
                  {def.source.library}
                </a>
              ) : (
                def.source.library
              )}
              , {def.source.licence}.
            </p>
          )}
          {part.datasheet && /^https?:/.test(part.datasheet) && (
            <p className="bc-note">
              <a href={part.datasheet} target="_blank" rel="noreferrer">
                Datasheet
              </a>
            </p>
          )}
        </section>
      ) : (
        pack && <PanelNote>Pick a part to see it, then Place. Double-click places it straight away.</PanelNote>
      )}
    </FeaturePanel>
  );
}
