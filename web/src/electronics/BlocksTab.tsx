import { useEffect, useId, useMemo, useRef, useState } from "react";
import { inflate, type ComponentDef, type LibraryPack } from "@bettercad/electronics";
import { KIND_TEXT } from "./pointKinds";
import { buildBlock, placeBlock, type BlockSpec, type BuiltBlock } from "@bettercad/electronics/blocks";
import { STARTER_BLOCKS } from "@bettercad/electronics/library/blocks";
import { blockFileText, buildOwn, readBlockFile, type OwnBlock } from "@bettercad/electronics/ownBlocks";
import { Button, Icon, PanelNote, cx } from "@bettercad/ui";
import { textOf } from "./fileText";
import { loadStarter } from "./starter";
import { eui } from "./ui";

const SHELVES: BlockSpec["shelf"][] = ["Power", "Motors", "Connectors", "Sensors and signals", "Your blocks"];

export { KIND_TEXT } from "./pointKinds";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Blocks that match every word typed, in their names, summaries, keywords or point names. */
export function searchBlocks(blocks: BlockSpec[], query: string): BlockSpec[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return blocks;
  return blocks.filter((b) => {
    const text = norm([b.name, b.summary, b.shelf, ...(b.keywords ?? []), ...b.points.map((p) => p.name)].join(" "));
    return words.every((w) => text.includes(w));
  });
}

/** Builds a spec from the library pack, or your own block from the parts inside it, or says which part is missing. */
function build(spec: BlockSpec, pack: LibraryPack | null, own?: OwnBlock): BuiltBlock | string | null {
  const lookup = (id: string): ComponentDef | undefined => {
    const part = pack?.parts.find((p) => p.id === id);
    return part && pack ? inflate(pack, part) : undefined;
  };
  if (!own && !pack) return null;
  try {
    return own ? buildOwn(own) : buildBlock(spec, lookup);
  } catch (e) {
    return (e as Error).message;
  }
}

/** A small drawing of a block: its outline, its parts as boxes, and its points on the edge. */
function BlockPicture({ built }: { built: BuiltBlock }) {
  const box = built.box;
  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;
  const pad = 6;
  const X = (x: number) => x - box.x1 + pad;
  const Y = (y: number) => box.y2 - y + pad;
  const labels = new Map(built.clip.labels.map((l) => [l.id, l]));
  return (
    <svg className="bc-ec-block-picture" viewBox={`0 0 ${w + pad * 2} ${h + pad * 2}`} role="img" aria-label={`Drawing of ${built.spec.name}`}>
      <rect x={pad} y={pad} width={w} height={h} rx={2} className="bc-ec-block-outline" />
      {built.clip.symbols.map((s) => {
        const part = built.clip.parts.find((p) => p.id === s.part)!;
        return (
          <g key={s.id}>
            <rect x={X(s.x) - 3} y={Y(s.y) - 3} width={6} height={6} rx={1} className="bc-ec-block-part" />
            {s.unit === 1 && (
              <text x={X(s.x)} y={Y(s.y) - 4.5} textAnchor="middle" className="bc-ec-block-ref">
                {part.ref}
              </text>
            )}
          </g>
        );
      })}
      {built.points.map((p) => {
        const l = labels.get(p.label)!;
        return <circle key={p.label} cx={X(l.x)} cy={Y(l.y)} r={1.4} className={cx("bc-ec-block-point", `bc-ec-point-${p.kind}`)} />;
      })}
    </svg>
  );
}

/**
 * The Blocks tab of the Components panel (#768): ready-made circuits on shelves, each said in plain words with what
 * it needs and the points you join it by. Place puts it on the pointer; click the sheet to drop it.
 */
export default function BlocksTab({
  own = [],
  onSave,
  onRemove,
}: {
  /** Your own blocks (#772), on the Your blocks shelf. */
  own?: OwnBlock[];
  onSave?: (b: OwnBlock) => void;
  onRemove?: (id: string) => void;
}) {
  const id = useId();
  const openFile = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState("");
  const [pack, setPack] = useState<LibraryPack | null>(null);
  const [failed, setFailed] = useState(false);
  const [find, setFind] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadStarter().then(
      (p) => live && setPack(p),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const all = useMemo(() => [...STARTER_BLOCKS, ...own.map((b) => b.spec)], [own]);
  const ownOf = (specId?: string) => own.find((b) => b.spec.id === specId);
  const found = useMemo(() => searchBlocks(all, find), [all, find]);
  const spec = all.find((b) => b.id === chosen);
  const mine = ownOf(spec?.id);
  const built = useMemo(() => (spec ? build(spec, pack, mine) : null), [spec, pack, mine]);
  const opened = async (file?: File) => {
    if (!file) return;
    const b = readBlockFile(await textOf(file));
    if (typeof b === "string") return setSaid(b);
    onSave?.(b);
    setChosen(b.spec.id);
    setSaid(`${b.spec.name} is on Your blocks.`);
  };
  const exportBlock = (b: OwnBlock) => {
    const url = URL.createObjectURL(new Blob([blockFileText(b)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${b.spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.bcblock.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const place = (b: BuiltBlock) =>
    eui.set({
      placingBlock: { built: b, place: (d, sheet, at) => placeBlock(d, sheet, b, at) },
      placing: null,
      schTool: "place",
      card: null,
      selected: [],
    });

  if (failed && !own.length) return <PanelNote>The blocks need the parts library, which did not load. Check your connection and open this again.</PanelNote>;
  return (
    <div className="bc-ec-blocks" role="tabpanel" aria-label="Blocks">
      <label className="bc-field-label" htmlFor={`${id}q`}>
        Find a block
      </label>
      <input
        id={`${id}q`}
        className="bc-text"
        type="search"
        value={find}
        autoFocus
        onChange={(e) => setFind(e.target.value)}
        placeholder="Motor, LiPo, I2C, 3.3 V"
      />
      {SHELVES.map((shelf) => {
        const here = found.filter((b) => b.shelf === shelf);
        if (!here.length) return null;
        return (
          <section key={shelf} aria-labelledby={`${id}${shelf.replace(/\W+/g, "-")}`}>
            <p className="bc-field-label" id={`${id}${shelf.replace(/\W+/g, "-")}`}>
              {shelf}
            </p>
            <ul className="bc-ec-parts bc-ec-parts-short">
              {here.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={cx("bc-ec-part", chosen === b.id && "bc-on")}
                    aria-pressed={chosen === b.id}
                    onClick={() => setChosen(b.id)}
                    onDoubleClick={() => {
                      const ready = build(b, pack, ownOf(b.id));
                      if (ready && typeof ready !== "string") place(ready);
                    }}
                  >
                    <Icon name="group" size={16} />
                    <span>{b.name}</span>
                    <small>{b.points.length} points</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {found.length === 0 && <p className="bc-note">Nothing matches. Try a shorter word.</p>}
      {!own.length && !find && <p className="bc-note">Your blocks: pick a group on the schematic and use Save as block, or open a block file.</p>}
      <div className="bc-ec-library-tools">
        <Button
          size="dense"
          variant="secondary"
          label="Open a block file"
          title="Add a block someone shared with you"
          onClick={() => openFile.current?.click()}
        />
        <input
          ref={openFile}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="A BetterCad block file"
          onChange={(e) => {
            void opened(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {said && (
        <p className="bc-note" role="status">
          {said}
        </p>
      )}
      {spec ? (
        <section className="bc-ec-part-card" aria-label={spec.name}>
          <header>
            <h3>{spec.name}</h3>
          </header>
          <p>{spec.summary}</p>
          {spec.needs && (
            <p className="bc-note">
              <strong>Needs:</strong> {spec.needs}
            </p>
          )}
          {built && typeof built !== "string" && <BlockPicture built={built} />}
          {typeof built === "string" && (
            <p className="bc-ec-blocked" role="alert">
              This block cannot be built: {built}
            </p>
          )}
          <p className="bc-field-label" id={`${id}points`}>
            Connection points
          </p>
          <ul className="bc-ec-block-points" aria-labelledby={`${id}points`}>
            {spec.points.map((p) => (
              <li key={p.name}>
                <span className={cx("bc-ec-point-dot", `bc-ec-point-${p.kind}`)} aria-hidden="true" />
                <strong>{p.name}</strong>
                <span>
                  {KIND_TEXT[p.kind]}
                  {p.volts ? `, ${p.volts}` : ""}
                  {p.required ? ", must be joined" : ""}
                </span>
                {p.note && <small>{p.note}</small>}
              </li>
            ))}
          </ul>
          <details>
            <summary>Inside ({spec.parts.length} parts)</summary>
            <ul className="bc-ec-block-inside">
              {spec.parts.map((p) => (
                <li key={p.ref}>
                  <strong>{p.ref}</strong> {p.value ? `${p.value}: ` : ""}
                  {p.note}
                </li>
              ))}
            </ul>
          </details>
          {spec.source.url ? (
            <p className="bc-note">
              Follows{" "}
              <a href={spec.source.url} target="_blank" rel="noreferrer">
                {spec.source.title}
              </a>
              .
            </p>
          ) : (
            <p className="bc-note">
              {spec.source.title}, version {spec.version}.
            </p>
          )}
          <Button
            variant="primary"
            label="Place"
            title={`Place ${spec.name} on the sheet`}
            disabled={!built || typeof built === "string"}
            onClick={() => built && typeof built !== "string" && place(built)}
          />
          {mine && (
            <div className="bc-ec-library-tools">
              <Button size="dense" variant="secondary" label="Export" title={`Save ${spec.name} as a file to share`} onClick={() => exportBlock(mine)} />
              <Button
                size="dense"
                variant="secondary"
                label="Delete"
                title={`Take ${spec.name} off Your blocks. Copies already placed stay`}
                onClick={() => {
                  onRemove?.(mine.spec.id);
                  setChosen(null);
                }}
              />
            </div>
          )}
        </section>
      ) : (
        <PanelNote>Pick a block to see what it does and how to join it, then Place. Double-click places it straight away.</PanelNote>
      )}
    </div>
  );
}
