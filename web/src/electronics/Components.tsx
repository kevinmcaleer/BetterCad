import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  categoriesOf,
  defKey,
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
import {
  PUBLISH_LICENCES,
  creditOf,
  fetchPartFiles,
  publishPack,
  shareLink,
  shareToken,
  useSharedParts,
  type PartsApi,
  type ShareStatus,
  type SharedPart,
} from "./sharedParts";
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
  /** From the shared catalogue (#625): who published it and whether it has been checked. */
  shared?: SharedPart;
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
  const { api, account, available } = useAccount();
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
  // Parts other people published (#625), once typing pauses. They sit under your own and the starter set's.
  const catalogue = useSharedParts(available ? api : undefined, shelf ? "" : find);
  const sharedRows = useMemo(
    (): Row[] => catalogue.parts.map((s) => ({ key: `cat:${s.id}`, part: s.pack.parts[0]!, pack: s.pack, mine: false, shared: s })),
    [catalogue.parts],
  );
  const browsing = !find.trim() && !shelf;
  const kept = (keys: string[]) => keys.flatMap((k) => byKey.get(k) ?? []);
  // A shared part stays picked while the list it came from changes under it.
  const [heldShared, setHeldShared] = useState<Row | null>(null);
  const row = chosen ? (byKey.get(chosen) ?? sharedRows.find((r) => r.key === chosen) ?? (heldShared?.key === chosen ? heldShared : undefined)) : undefined;
  const part = row?.part;
  const def = useMemo(() => (row ? inflate(row.pack, row.part) : null), [row]);
  // Parts in this design that keep an older copy of the part picked (#629): same name and maker, different contents.
  const stale = useMemo(() => {
    if (!design || !def) return [];
    const key = defKey(def);
    return design.parts.filter((p) => {
      const kept = design.defs[p.def];
      return !!kept && p.def !== key && kept.name === def.name && (kept.source?.library ?? "") === (def.source?.library ?? "");
    });
  }, [design, def]);

  // The part's card sits under the list: bring it into view when a part is picked.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (chosen) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [chosen]);

  const choose = (r: Row) => {
    setChosen(r.key);
    setPkg(0);
    if (r.shared) {
      setHeldShared(r);
      // Its body's file, if it has one, comes from its publisher so it is here by the time the part is placed.
      void fetchPartFiles(api, `parts-catalogue/${r.shared.id}`, [inflate(r.pack, r.part)]);
    }
  };
  // Which of your parts are published, and how each stands.
  const [published, setPublished] = useState<Record<string, ShareStatus>>({});
  useEffect(() => {
    if (!account) return setPublished({});
    let live = true;
    api
      .call<{ parts: { part: string; status: ShareStatus }[] }>("GET", "parts-catalogue/mine")
      .then((r) => live && setPublished(Object.fromEntries(r.parts.map((p) => [p.part, p.status]))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [account, api]);
  // A link to your whole library, and adding someone else's from theirs.
  const [link, setLink] = useState("");
  const [linking, setLinking] = useState(false);
  const [from, setFrom] = useState("");
  useEffect(() => {
    if (!account) return setLink("");
    let live = true;
    api
      .call<{ token: string | null }>("GET", "parts-library/share")
      .then((r) => live && setLink(r.token ? shareLink(api, r.token) : ""))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [account, api]);
  const upload = (defs: ComponentDef[]) => {
    if (!account) return;
    for (const h of stepFiles(defs)) {
      const data = fileOf(h);
      if (data) api.putBlob(h, fromBase64(data), "model/step").catch(() => undefined);
    }
  };
  const share = async () => {
    try {
      const made = shareLink(api, (await api.call<{ token: string }>("POST", "parts-library/share")).token);
      setLink(made);
      const copied = await navigator.clipboard?.writeText(made).then(
        () => true,
        () => false,
      );
      setSaid(copied ? "A link to your parts is copied. Anyone with it can add them to theirs." : "Anyone with this link can add your parts to theirs.");
    } catch (e) {
      setSaid((e as Error).message || "The link could not be made.");
    }
  };
  const unshare = async () => {
    try {
      await api.call("DELETE", "parts-library/share");
      setLink("");
      setSaid("The link no longer works.");
    } catch (e) {
      setSaid((e as Error).message || "The link could not be taken back.");
    }
  };
  const addFrom = async () => {
    const token = shareToken(from);
    if (!token) return setSaid("That is not a link to a BetterCad parts library.");
    try {
      const got = await api.call<{ pack: unknown; by: string }>("GET", `parts-library/shared/${token}`);
      if (!isPack(got.pack) || !got.pack.parts.length) return setSaid("That library has no parts in it yet.");
      const pack = got.pack;
      const defs = pack.parts.map((p) => inflate(pack, p));
      await fetchPartFiles(api, `parts-library/shared/${token}`, defs);
      upload(defs);
      const n = my.add(pack);
      setShelf(MINE);
      setFrom("");
      setLinking(false);
      const whose = got.by ? `${got.by}'s library` : "that library";
      setSaid(n ? `Added ${n} ${n === 1 ? "part" : "parts"} from ${whose}.` : `Every part in ${whose} was already in yours.`);
    } catch (e) {
      setSaid((e as Error).message || "That link could not be read.");
    }
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
        aria-label={`${r.part.name} (${r.part.packages.length ? labelOf(r.part) : r.pack.symbols[r.part.symbol]?.power ? "Power" : "No footprint"}${
          r.shared ? `, from ${r.shared.by}${r.shared.status === "approved" ? "" : ", unreviewed"}` : ""
        })`}
        onClick={() => choose(r)}
        onDoubleClick={() => place(r, 0)}
      >
        <Icon name={r.pack.symbols[r.part.symbol]?.power ? "powerSymbol" : "chip"} size={16} />
        <span>{r.part.name}</span>
        <small>
          {r.shared ? (r.shared.status === "approved" ? "Shared" : "Unreviewed") : r.mine ? "Yours" : r.part.packages.length ? labelOf(r.part) : "Power"}
        </small>
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
          {account && my.pack.parts.length > 0 && !link && (
            <Button size="dense" variant="secondary" label="Share by link" title="Make a link anyone can add your parts from" onClick={() => void share()} />
          )}
          <Button
            size="dense"
            variant="secondary"
            label="Add from a link"
            title="Add the parts of a library someone shared with you"
            on={linking}
            onClick={() => setLinking((v) => !v)}
          />
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
        {link && (
          <>
            <label className="bc-field-label" htmlFor={`${field}-link`}>
              Link to your parts
            </label>
            <input id={`${field}-link`} className="bc-text" readOnly value={link} onFocus={(e) => e.target.select()} />
            <div className="bc-ec-library-tools">
              <Button size="dense" variant="secondary" label="Stop sharing" title="The link stops working" onClick={() => void unshare()} />
            </div>
          </>
        )}
        {linking && (
          <>
            <label className="bc-field-label" htmlFor={`${field}-from`}>
              Link to a library
            </label>
            <input
              id={`${field}-from`}
              className="bc-text"
              value={from}
              placeholder="Paste the link you were sent"
              onChange={(e) => setFrom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addFrom()}
            />
            <div className="bc-ec-library-tools">
              <Button size="dense" variant="primary" label="Add its parts" disabled={!from.trim()} onClick={() => void addFrom()} />
            </div>
          </>
        )}
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
            {found.length === 0 && sharedRows.length === 0 && <li className="bc-note">Nothing matches. Try a shorter word.</li>}
            {found.length > SHOWN && (
              <li className="bc-note">
                Showing {SHOWN} of {found.length}. Type a word or pick a shelf to narrow it.
              </li>
            )}
          </ul>
        )}
        {ready && sharedRows.length > 0 && (
          <>
            <p className="bc-field-label" id={`${field}-shared`}>
              From other makers
            </p>
            <ul className="bc-ec-parts bc-ec-parts-short" aria-labelledby={`${field}-shared`}>
              {sharedRows.map((r) => line(r, "shared"))}
            </ul>
          </>
        )}
        {ready && catalogue.offline && <p className="bc-note">Parts from other makers need a connection. These are the ones kept in this browser.</p>}
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
            {row.shared && (
              <p className="bc-note">
                Published by {row.shared.by}.{" "}
                {row.shared.status === "approved" ? "Checked by BetterCad." : "Not checked yet: hold it against the datasheet before you order a board."}
              </p>
            )}
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
              {row.shared && (
                <Button
                  size="dense"
                  variant="secondary"
                  label="Add to your parts"
                  title="Keep a copy in your own library"
                  onClick={() => {
                    upload([def]);
                    const n = my.add(row.pack);
                    setSaid(n ? `${part.name} is in your parts.` : `${part.name} was already in your parts.`);
                  }}
                />
              )}
              {stale.length > 0 && edit && (
                <Button
                  size="dense"
                  variant="secondary"
                  label={`Update ${stale.length === 1 ? stale[0]!.ref : `${stale.length} parts`}`}
                  title={`This design keeps its own copy of ${part.name}, made before it changed. Swap in the part as it is now`}
                  onClick={() => {
                    edit((d) => stale.reduce((now, p) => replacePart(now, p.id, def, p.pkg).design, d), `Update ${part.name}`);
                    setSaid(`Updated ${stale.map((p) => p.ref).join(", ")} to ${part.name} as it is now.`);
                  }}
                />
              )}
            </div>
            {row.mine && (
              <PublishPart
                key={part.id}
                api={api}
                you={account?.name ?? ""}
                id={part.id}
                def={def}
                category={part.category}
                status={published[part.id]}
                onFiles={() => upload([def])}
                onDone={(status, text) => {
                  setPublished((now) => {
                    const next = { ...now };
                    if (status) next[part.id] = status;
                    else delete next[part.id];
                    return next;
                  });
                  setSaid(text);
                }}
              />
            )}
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

/** Publish one of your parts to the shared catalogue (#629), under a licence that lets other people use it. */
function PublishPart(p: {
  api: PartsApi;
  /** Your name, for the credit. Empty when signed out. */
  you: string;
  id: string;
  def: ComponentDef;
  category: string;
  status: ShareStatus | undefined;
  /** Sends the part's body files to your account first, so the catalogue can serve them. */
  onFiles: () => void;
  onDone: (status: ShareStatus | null, text: string) => void;
}) {
  const own = p.def.source?.licence ?? "";
  const [licence, setLicence] = useState(PUBLISH_LICENCES.includes(own) ? own : "CC-BY 4.0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();
  if (!p.you) return <p className="bc-note">Sign in to publish this part to the shared catalogue.</p>;
  const credit = creditOf(p.def, p.you);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message || "That did not work. Try again.");
    }
    setBusy(false);
  };
  const publish = () =>
    run(async () => {
      p.onFiles();
      const pack = publishPack(p.id, p.def, p.category, licence, credit);
      const r = await p.api.call<{ status: ShareStatus }>("POST", "parts-catalogue", { id: p.id, pack, licence, credit });
      p.onDone(r.status, `${p.def.name} is published. It shows as Unreviewed until it is checked.`);
    });
  const unpublish = () =>
    run(async () => {
      await p.api.call("DELETE", `parts-catalogue/mine/${encodeURIComponent(p.id)}`);
      p.onDone(null, `${p.def.name} is out of the shared catalogue. It stays in your parts.`);
    });
  return (
    <fieldset className="bc-ec-symed-props">
      <legend>Shared catalogue</legend>
      {p.status && (
        <p className="bc-note" role="status">
          {p.status === "approved"
            ? "Published and checked."
            : p.status === "rejected"
              ? "Not accepted into the catalogue. Change it and publish it again."
              : "Published. It shows as Unreviewed until it is checked."}
        </p>
      )}
      <label className="bc-field-label" htmlFor={`${ids}lic`}>
        Licence to publish under
      </label>
      <select id={`${ids}lic`} className="bc-select" value={licence} onChange={(e) => setLicence(e.target.value)}>
        {PUBLISH_LICENCES.map((l) => (
          <option key={l}>{l}</option>
        ))}
      </select>
      <p className="bc-note">Credit: {credit}. Anyone can find a published part and use it under this licence.</p>
      <div className="bc-ec-library-tools">
        <Button size="dense" variant="secondary" label={p.status ? "Publish again" : "Publish"} busy={busy} onClick={() => void publish()} />
        {p.status && <Button size="dense" variant="secondary" label="Unpublish" disabled={busy} onClick={() => void unpublish()} />}
      </div>
      {error && (
        <p className="bc-ec-blocked" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export default ComponentsCard;
