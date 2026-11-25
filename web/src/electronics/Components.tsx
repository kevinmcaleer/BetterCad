import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  categoriesOf,
  emptyPack,
  inflate,
  isPack,
  putPart,
  searchPack,
  type ComponentDef,
  type ElectronicsDesign,
  type LibraryPack,
  type PackPart,
} from "@bettercad/electronics";
import { replacePart } from "@bettercad/electronics/replace";
import { Button, ESC, FeaturePanel, Icon, PanelNote, cx, useEscape } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { textOf } from "./fileText";
import { useAccount } from "../cloud/account";
import { fromBase64, toBase64 } from "@bettercad/kernel";
import type { KernelCall } from "./bodyFile";
import { MY_PARTS, libraryFile, useMyLibrary } from "./myLibrary";
import { fileOf, keepFile, loadFiles, stepFiles } from "./partBlobs";
import type { EditStart } from "./PartTools";
import { noteRecent, recentParts, starredParts, toggleStar } from "./partPrefs";
import { PartPreview } from "./PartPreview";
import { basicsPack, loadStarter } from "./starter";
import { eui } from "./ui";
import { useEui } from "./useEui";

// The editor and the importer carry the wizards and the KiCad readers: fetched when one is opened.
const PartEditor = lazy(() => import("./PartTools").then((m) => ({ default: m.PartEditor })));
const ImportParts = lazy(() => import("./PartTools").then((m) => ({ default: m.ImportParts })));

/** How many results the list draws at once. More than this and typing another word is quicker than scrolling. */
const SHOWN = 60;

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

interface Row {
  /** What recent and starred lists keep: the part's id, with "my:" in front for one of yours. */
  key: string;
  part: PackPart;
  pack: LibraryPack;
  mine: boolean;
}
const MINE = "@mine";

function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The Components panel (#625): find a part in the starter library or among your own by name, value, package or
 * keyword, look at its symbol and footprint, pick the package, then place it. Parts you starred and parts you placed
 * lately sit on top. From here you also make a part, import KiCad files, and save or open your library as a file.
 */
export function ComponentsCard({ onClose, design, edit, call }: { onClose: () => void; design?: ElectronicsDesign; edit?: EEdit; call?: KernelCall }) {
  // One part picked on the sheet can be swapped for the one picked here (#631).
  const picked = useEui().selected;
  const symbol = picked.length === 1 ? design?.sheets.flatMap((s) => s.symbols).find((y) => y.id === picked[0]) : undefined;
  const swap = design?.parts.find((p) => p.id === symbol?.part && !design.defs[p.def]?.symbol.power);
  const [starter, setStarter] = useState<LibraryPack | null>(null);
  const [failed, setFailed] = useState(false);
  const [find, setFind] = useState("");
  const [shelf, setShelf] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [pkg, setPkg] = useState(0);
  const [recent, setRecent] = useState(recentParts);
  const [starred, setStarred] = useState(starredParts);
  const [editing, setEditing] = useState<EditStart | null>(null);
  const [importing, setImporting] = useState(false);
  const [said, setSaid] = useState("");
  // Your own parts go in your account when you are signed in.
  const { api, account } = useAccount();
  const my = useMyLibrary(api, !!account);
  const field = useId();
  const shelfId = useId();
  const pkgId = useId();
  const openFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadStarter().then(
      (p) => live && setStarter(p),
      () => {
        if (!live) return;
        setFailed(true);
        setStarter(basicsPack());
      },
    );
    return () => {
      live = false;
    };
  }, []);
  // The editor and the importer are dialogs with their own Esc; the panel's waits behind them.
  useEscape(!editing && !importing, onClose, ESC.panel);

  const rows = (pack: LibraryPack, mine: boolean, parts: PackPart[]): Row[] =>
    parts.map((part) => ({ key: mine ? `my:${part.id}` : part.id, part, pack, mine }));
  const found = useMemo(() => {
    const category = shelf && shelf !== MINE ? shelf : undefined;
    return [
      ...rows(my.pack, true, searchPack(my.pack, find, category)),
      ...(starter && shelf !== MINE ? rows(starter, false, searchPack(starter, find, category)) : []),
    ];
  }, [starter, my.pack, find, shelf]);
  const byKey = useMemo(
    () => new Map([...rows(my.pack, true, my.pack.parts), ...(starter ? rows(starter, false, starter.parts) : [])].map((r) => [r.key, r])),
    [starter, my.pack],
  );
  const shelves = useMemo(
    () => [...new Set([...(starter ? categoriesOf(starter) : []), ...categoriesOf(my.pack)])].filter((c) => c !== MY_PARTS),
    [starter, my.pack],
  );
  const browsing = !find.trim() && !shelf;
  const kept = (keys: string[]) => keys.flatMap((k) => byKey.get(k) ?? []);
  const row = chosen ? byKey.get(chosen) : undefined;
  const part = row?.part;
  const def = useMemo(() => (row ? inflate(row.pack, row.part) : null), [row]);

  // The part's card sits under the list: bring it into view when a part is picked.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (chosen) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [chosen]);

  const choose = (r: Row) => {
    setChosen(r.key);
    setPkg(0);
  };
  const place = (r = row, at = pkg) => {
    if (!r) return;
    setRecent(noteRecent(r.key));
    eui.set({ placing: inflate(r.pack, r.part), placingPkg: at, schTool: "place", card: null, selected: [] });
  };
  // The files your parts' bodies come from (#628): read from this browser when the panel opens, and any that are
  // only in your account fetched from there, so a part made on another machine brings its body.
  const packDefs = useMemo(() => my.pack.parts.map((p) => inflate(my.pack, p)), [my.pack]);
  useEffect(() => {
    let live = true;
    void loadFiles().then(() => {
      if (!live || !account) return;
      for (const h of stepFiles(packDefs))
        if (!fileOf(h))
          api
            .getBlob(h)
            .then((bytes) => keepFile(h, toBase64(bytes)))
            .catch(() => undefined);
    });
    return () => {
      live = false;
    };
  }, [packDefs, account, api]);
  const saved = (made: ComponentDef, to: string, id?: string, files: Record<string, string> = {}) => {
    for (const [h, data] of Object.entries(files)) {
      keepFile(h, data);
      if (account) api.putBlob(h, fromBase64(data), "model/step").catch(() => undefined);
    }
    const as = my.save(made, to, id);
    setEditing(null);
    setFind("");
    setShelf(MINE);
    setChosen(`my:${as}`);
    setPkg(0);
    setSaid(`${made.name} is in your parts.`);
  };
  const imported = (defs: ComponentDef[]) => {
    let pack = emptyPack("Imported");
    defs.forEach((d, i) => (pack = putPart(pack, `import-${i}`, d, MY_PARTS)));
    // Ids are made from the names once they meet your library, so a second import of the same file adds nothing.
    const named = {
      ...pack,
      parts: pack.parts.map((p) => ({
        ...p,
        id:
          p.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || p.id,
      })),
    };
    const n = my.add(named);
    setImporting(false);
    setShelf(MINE);
    setSaid(n ? `Added ${n} ${n === 1 ? "part" : "parts"} to your parts.` : "Those parts were already in your library.");
  };
  const opened = async (file: File | undefined) => {
    if (!file) return;
    try {
      const pack = JSON.parse(await textOf(file)) as unknown;
      if (!isPack(pack)) throw new Error("not a pack");
      // A library file carries the files its parts' bodies come from.
      const files = (pack as { files?: unknown }).files;
      if (files && typeof files === "object")
        for (const [h, data] of Object.entries(files)) {
          if (typeof data !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(h)) continue;
          keepFile(h, data);
          if (account) api.putBlob(h, fromBase64(data), "model/step").catch(() => undefined);
        }
      delete (pack as { files?: unknown }).files;
      const n = my.add(pack);
      setShelf(MINE);
      setSaid(n ? `Added ${n} ${n === 1 ? "part" : "parts"} from ${file.name}.` : `Every part in ${file.name} was already in your library.`);
    } catch {
      setSaid(`${file.name} is not a BetterCad parts library.`);
    }
  };

  const line = (r: Row, list: string) => (
    <li key={`${list}-${r.key}`}>
      <button
        type="button"
        className={cx("bc-ec-part", chosen === r.key && "bc-on")}
        aria-pressed={chosen === r.key}
        aria-label={`${r.part.name} (${r.part.packages.length ? labelOf(r.part) : r.pack.symbols[r.part.symbol]?.power ? "Power" : "No footprint"})`}
        onClick={() => choose(r)}
        onDoubleClick={() => place(r, 0)}
      >
        <Icon name={r.pack.symbols[r.part.symbol]?.power ? "powerSymbol" : "chip"} size={16} />
        <span>{r.part.name}</span>
        <small>{r.mine ? "Yours" : r.part.packages.length ? labelOf(r.part) : "Power"}</small>
      </button>
    </li>
  );
  const ready = !!starter;

  return (
    <>
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
          {my.pack.parts.length > 0 && <option value={MINE}>Your parts ({my.pack.parts.length})</option>}
          {shelves.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <div className="bc-ec-library-tools" role="group" aria-label="Your library">
          <Button size="dense" variant="secondary" label="New part" title="Make a part: symbol, footprint and body" onClick={() => setEditing({})} />
          <Button
            size="dense"
            variant="secondary"
            label="Import parts"
            title="Add parts from KiCad files (.kicad_sym, .kicad_mod) or Eagle libraries (.lbr)"
            onClick={() => setImporting(true)}
          />
          <Button
            size="dense"
            variant="secondary"
            label="Open library"
            title="Add the parts in a BetterCad library file"
            onClick={() => openFile.current?.click()}
          />
          {my.pack.parts.length > 0 && (
            <Button
              size="dense"
              variant="secondary"
              label="Export"
              title="Save your parts as a library file"
              onClick={() =>
                saveAs(
                  libraryFile(my.pack, Object.fromEntries(stepFiles(packDefs).flatMap((h) => (fileOf(h) ? [[h, fileOf(h)!]] : [])))),
                  "your-parts.bcparts.json",
                )
              }
            />
          )}
          <input
            ref={openFile}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="A BetterCad library file"
            onChange={(e) => {
              void opened(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {(said || !my.kept) && (
          <p className="bc-note" role="status">
            {[said, !my.kept && "This browser would not keep your parts. Export them to a file so they are not lost."].filter(Boolean).join(" ")}
          </p>
        )}
        {!ready && (
          <p className="bc-note" role="status">
            Fetching the parts library.
          </p>
        )}
        {failed && <PanelNote>The parts library did not load, so these are the basics. Close this and open it again to retry.</PanelNote>}
        {ready && browsing && kept(starred).length > 0 && (
          <ul className="bc-ec-parts bc-ec-parts-short" aria-label="Starred parts">
            {kept(starred).map((r) => line(r, "star"))}
          </ul>
        )}
        {ready && browsing && kept(recent).length > 0 && (
          <ul className="bc-ec-parts bc-ec-parts-short" aria-label="Parts you placed lately">
            {kept(recent).map((r) => line(r, "recent"))}
          </ul>
        )}
        {ready && (
          <ul className="bc-ec-parts" aria-label="Parts">
            {found.slice(0, SHOWN).map((r) => line(r, "all"))}
            {found.length === 0 && <li className="bc-note">Nothing matches. Try a shorter word.</li>}
            {found.length > SHOWN && (
              <li className="bc-note">
                Showing {SHOWN} of {found.length}. Type a word or pick a shelf to narrow it.
              </li>
            )}
          </ul>
        )}
        {row && part && def ? (
          <section ref={cardRef} className="bc-ec-part-card" aria-label={part.name}>
            <header>
              <h3>{part.name}</h3>
              <button
                type="button"
                className="bc-ec-star"
                aria-pressed={starred.includes(row.key)}
                aria-label={`Star ${part.name}`}
                data-tip={starred.includes(row.key) ? "Take off your starred parts" : "Keep at the top of the list"}
                onClick={() => setStarred(toggleStar(row.key))}
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
            <div className="bc-ec-library-tools">
              {swap && edit && design && (
                <Button
                  size="dense"
                  variant="secondary"
                  label={`Replace ${swap.ref}`}
                  title={`Swap ${swap.ref} for this part and keep its wires where the pins match`}
                  onClick={() => {
                    const { lost } = replacePart(design, swap.id, def, pkg);
                    edit((d) => replacePart(d, swap.id, def, pkg).design, `Replace ${swap.ref}`);
                    setSaid(
                      lost.length
                        ? `Replaced ${swap.ref}. ${lost.length === 1 ? `The wire on pin ${lost[0]} has` : `The wires on pins ${lost.join(", ")} have`} no pin to join now.`
                        : `Replaced ${swap.ref}. Its wires are still joined.`,
                    );
                  }}
                />
              )}
              {row.mine ? (
                <>
                  <Button
                    size="dense"
                    variant="secondary"
                    label="Edit"
                    title="Change this part"
                    onClick={() => setEditing({ def, id: part.id, shelf: part.category === MY_PARTS ? "" : part.category })}
                  />
                  <Button
                    size="dense"
                    variant="secondary"
                    label="Delete"
                    title="Take it out of your parts. Designs that use it keep their copy"
                    onClick={() => {
                      my.remove(part.id);
                      setChosen(null);
                      setSaid(`${part.name} is out of your parts. Designs that use it keep their own copy.`);
                    }}
                  />
                </>
              ) : (
                <Button size="dense" variant="secondary" label="Edit a copy" title="Make your own part from this one" onClick={() => setEditing({ def })} />
              )}
            </div>
          </section>
        ) : (
          ready && <PanelNote>Pick a part to see it, then Place. Double-click places it straight away.</PanelNote>
        )}
      </FeaturePanel>
      {(editing || importing) && (
        <Suspense fallback={null}>
          {editing && <PartEditor start={editing} shelves={shelves} onSave={saved} onCancel={() => setEditing(null)} {...(call ? { call } : {})} />}
          {importing && <ImportParts known={(name) => starter?.footprints[name]} onAdd={imported} onCancel={() => setImporting(false)} />}
        </Suspense>
      )}
    </>
  );
}

export default ComponentsCard;
