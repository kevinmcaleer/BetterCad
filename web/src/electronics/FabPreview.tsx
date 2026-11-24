import { useEffect, useMemo, useRef, useState } from "react";
import { readDrill, readGerber, type Aperture, type DrillHit, type GerberImage } from "@bettercad/electronics/fab/read";
import { Button } from "@bettercad/ui";
import { readColours, type ColourKey } from "./colours";

/**
 * The manufacturing preview (#657): the files just written, read back and drawn layer by layer, as a board house
 * will see them. It draws from the files, never from the design, so it is a second pair of eyes. A Gerber zip from
 * anywhere can be opened in it too.
 */
export interface FabFile {
  name: string;
  text: string;
}

type Kind =
  "copper-top" | "copper-bottom" | "mask-top" | "mask-bottom" | "paste-top" | "paste-bottom" | "silk-top" | "silk-bottom" | "edge" | "drill" | "other";

interface Layer {
  name: string;
  kind: Kind;
  label: string;
  image?: GerberImage;
  hits?: DrillHit[];
}

const LABEL: Record<Kind, string> = {
  "copper-top": "Top copper",
  "copper-bottom": "Bottom copper",
  "mask-top": "Top mask openings",
  "mask-bottom": "Bottom mask openings",
  "paste-top": "Top paste",
  "paste-bottom": "Bottom paste",
  "silk-top": "Top silkscreen",
  "silk-bottom": "Bottom silkscreen",
  edge: "Outline",
  drill: "Drill hits",
  other: "Other",
};
const COLOUR: Record<Kind, ColourKey> = {
  "copper-top": "ec-copper-top",
  "copper-bottom": "ec-copper-bottom",
  "mask-top": "ec-mark",
  "mask-bottom": "ec-mark",
  "paste-top": "ec-pad",
  "paste-bottom": "ec-pad",
  "silk-top": "ec-silk",
  "silk-bottom": "ec-silk-far",
  edge: "ec-edge",
  drill: "ec-hole",
  other: "muted",
};
/** Bottom of the stack first, so the top side draws over the bottom. */
const ORDER: Kind[] = [
  "other",
  "copper-bottom",
  "mask-bottom",
  "paste-bottom",
  "silk-bottom",
  "copper-top",
  "mask-top",
  "paste-top",
  "silk-top",
  "edge",
  "drill",
];
const EXT: Record<string, Kind> = {
  GTL: "copper-top",
  GBL: "copper-bottom",
  GTS: "mask-top",
  GBS: "mask-bottom",
  GTP: "paste-top",
  GBP: "paste-bottom",
  GTO: "silk-top",
  GBO: "silk-bottom",
  GKO: "edge",
  GM1: "edge",
};

/** What a file is: by what it says of itself first, then by its name. */
export function kindOf(name: string, fn?: string): Kind {
  if (fn) {
    const [what, a, b] = fn.split(",");
    const side = [a, b].includes("Bot") ? "bottom" : "top";
    if (what === "Copper") return `copper-${side}`;
    if (what === "Soldermask") return `mask-${side}`;
    if (what === "Paste") return `paste-${side}`;
    if (what === "Legend") return `silk-${side}`;
    if (what === "Profile") return "edge";
  }
  const ext = name.split(".").pop()!.toUpperCase();
  if (EXT[ext]) return EXT[ext];
  const n = name.toLowerCase();
  const side = /b[._-]|bottom|back/.test(n) ? "bottom" : "top";
  if (/edge|outline|profile/.test(n)) return "edge";
  if (/silk|legend/.test(n)) return `silk-${side}`;
  if (/mask/.test(n)) return `mask-${side}`;
  if (/paste/.test(n)) return `paste-${side}`;
  if (/cu\b|copper/.test(n)) return `copper-${side}`;
  return "other";
}

/** Reads a set of files into layers, in drawing order. Files that are neither Gerber nor drill are left out. */
export function readLayers(files: FabFile[]): Layer[] {
  const out: Layer[] = [];
  for (const f of files) {
    const head = f.text.slice(0, 400);
    if (/^\s*M48/.test(head)) out.push({ name: f.name, kind: "drill", label: `${LABEL.drill}, ${f.name}`, hits: readDrill(f.text).hits });
    else if (/%FS|%MO|G04/.test(head)) {
      const image = readGerber(f.text);
      const kind = kindOf(f.name, image.fn);
      out.push({ name: f.name, kind, label: kind === "other" ? f.name : LABEL[kind], image });
    }
  }
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

interface View {
  scale: number;
  ox: number;
  oy: number;
  /** Seen from below: mirrored left to right. */
  flip: boolean;
}

function stamp(o: CanvasRenderingContext2D, ap: Aperture, k: number) {
  if (ap.kind === "circle") {
    o.beginPath();
    o.arc(0, 0, (ap.d / 2) * k, 0, Math.PI * 2);
    o.fill();
  } else if (ap.kind === "rect") o.fillRect((-ap.w / 2) * k, (-ap.h / 2) * k, ap.w * k, ap.h * k);
  else if (ap.kind === "obround") {
    const r = Math.min(ap.w, ap.h) / 2;
    const half = Math.max(ap.w, ap.h) / 2 - r;
    o.lineCap = "round";
    o.lineWidth = 2 * r * k;
    o.beginPath();
    if (ap.w >= ap.h) {
      o.moveTo(-half * k, 0);
      o.lineTo(half * k, 0);
    } else {
      o.moveTo(0, -half * k);
      o.lineTo(0, half * k);
    }
    o.stroke();
  } else
    for (const p of ap.prims) {
      if (!p.dark) continue;
      o.beginPath();
      if (p.kind === "disc") o.arc(p.at[0] * k, -p.at[1] * k, (p.d / 2) * k, 0, Math.PI * 2);
      else p.pts.forEach(([x, y], i) => (i ? o.lineTo(x * k, -y * k) : o.moveTo(x * k, -y * k)));
      o.fill();
    }
}

/** One layer onto a canvas of its own: dark adds, clear takes away. */
function paint(o: CanvasRenderingContext2D, layer: Layer, v: View, colour: string) {
  const sx = (x: number) => (v.flip ? -x : x) * v.scale + v.ox;
  const sy = (y: number) => v.oy - y * v.scale;
  o.fillStyle = colour;
  o.strokeStyle = colour;
  for (const op of layer.image?.ops ?? []) {
    o.globalCompositeOperation = op.dark ? "source-over" : "destination-out";
    if (op.kind === "flash") {
      o.save();
      o.translate(sx(op.at[0]), sy(op.at[1]));
      if (v.flip) o.scale(-1, 1);
      stamp(o, op.ap, v.scale);
      o.restore();
      continue;
    }
    o.beginPath();
    op.pts.forEach(([x, y], i) => (i ? o.lineTo(sx(x), sy(y)) : o.moveTo(sx(x), sy(y))));
    if (op.kind === "region") o.fill("evenodd");
    else {
      o.lineCap = "round";
      o.lineJoin = "round";
      o.lineWidth = Math.max(1, op.pen * v.scale);
      o.stroke();
    }
  }
  o.globalCompositeOperation = "source-over";
  for (const h of layer.hits ?? []) {
    o.lineCap = "round";
    o.lineWidth = h.d * v.scale;
    o.beginPath();
    o.moveTo(sx(h.at[0]), sy(h.at[1]));
    o.lineTo(sx((h.to ?? h.at)[0]) + 0.01, sy((h.to ?? h.at)[1]));
    o.stroke();
  }
}

function boxOf(layers: Layer[]) {
  let b: { x1: number; y1: number; x2: number; y2: number } | null = null;
  const grow = (x1: number, y1: number, x2: number, y2: number) => {
    b = b ? { x1: Math.min(b.x1, x1), y1: Math.min(b.y1, y1), x2: Math.max(b.x2, x2), y2: Math.max(b.y2, y2) } : { x1, y1, x2, y2 };
  };
  // The outline says how big the board is; without one, everything drawn does.
  const edge = layers.filter((l) => l.kind === "edge" && l.image?.box);
  for (const l of edge.length ? edge : layers) {
    if (l.image?.box) grow(l.image.box.x1, l.image.box.y1, l.image.box.x2, l.image.box.y2);
    for (const h of l.hits ?? []) grow(h.at[0], h.at[1], h.at[0], h.at[1]);
  }
  return b ?? { x1: 0, y1: 0, x2: 10, y2: 10 };
}

export default function FabPreview({ files }: { files: FabFile[] }) {
  const [own, setOwn] = useState<FabFile[] | null>(null);
  const [bad, setBad] = useState("");
  const layers = useMemo(() => readLayers(own ?? files), [own, files]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [side, setSide] = useState<"top" | "bottom">("top");
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const [measure, setMeasure] = useState(false);
  const [marks, setMarks] = useState<[number, number][]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const box = useMemo(() => boxOf(layers), [layers]);
  const skipped = [...new Set(layers.flatMap((l) => l.image?.skipped ?? []))];

  const viewOf = (el: HTMLCanvasElement): View => {
    const [w, h] = [el.clientWidth, el.clientHeight];
    const fit = Math.min((w - 24) / Math.max(box.x2 - box.x1, 1), (h - 24) / Math.max(box.y2 - box.y1, 1));
    const scale = fit * zoom.k;
    const flip = side === "bottom";
    const cx = (box.x1 + box.x2) / 2;
    const cy = (box.y1 + box.y2) / 2;
    return { scale, flip, ox: w / 2 - (flip ? -cx : cx) * scale + zoom.x, oy: h / 2 + cy * scale + zoom.y };
  };

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const [w, h] = [el.clientWidth, el.clientHeight];
    el.width = Math.round(w * ratio);
    el.height = Math.round(h * ratio);
    const colours = readColours(el);
    const v = viewOf(el);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = colours["ec-pcb-bg"];
    ctx.fillRect(0, 0, w, h);
    const scratch = document.createElement("canvas");
    scratch.width = el.width;
    scratch.height = el.height;
    const o = scratch.getContext("2d");
    if (!o) return;
    // The side you are looking at goes on last, so it is on top.
    const far = side === "top" ? "bottom" : "top";
    const stack = [...layers.filter((l) => l.kind.endsWith(far)), ...layers.filter((l) => !l.kind.endsWith(far))];
    for (const layer of stack) {
      if (hidden.has(layer.name)) continue;
      o.setTransform(ratio, 0, 0, ratio, 0, 0);
      o.clearRect(0, 0, w, h);
      paint(o, layer, v, colours[COLOUR[layer.kind]]);
      ctx.globalAlpha = layer.kind.endsWith(far) ? 0.45 : 0.9;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(scratch, 0, 0);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    ctx.globalAlpha = 1;
    if (marks.length) {
      ctx.strokeStyle = colours["ec-pick"];
      ctx.fillStyle = colours["ec-pick"];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      marks.forEach(([x, y], i) => {
        const p: [number, number] = [(v.flip ? -x : x) * v.scale + v.ox, v.oy - y * v.scale];
        if (i) ctx.lineTo(...p);
        else ctx.moveTo(...p);
        ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4);
      });
      ctx.stroke();
    }
  });

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const el = canvas.current!;
    const r = el.getBoundingClientRect();
    const v = viewOf(el);
    const x = (e.clientX - r.left - v.ox) / v.scale;
    return [v.flip ? -x : x, (v.oy - (e.clientY - r.top)) / v.scale];
  };

  const open = async (file: File) => {
    setBad("");
    try {
      const { unzip } = await import("@bettercad/kernel/zip");
      const dec = new TextDecoder();
      const found = [...unzip(new Uint8Array(await file.arrayBuffer()))].map(([name, data]) => ({ name: name.split("/").pop()!, text: dec.decode(data) }));
      if (!readLayers(found).length) throw new Error("There are no Gerber or drill files in that zip.");
      setOwn(found);
      setHidden(new Set());
      setZoom({ k: 1, x: 0, y: 0 });
      setMarks([]);
    } catch (e) {
      setBad((e as Error)?.message || "That zip didn't open.");
    }
  };

  const length = marks.length === 2 ? Math.hypot(marks[1]![0] - marks[0]![0], marks[1]![1] - marks[0]![1]) : null;
  const shown = layers.filter((l) => !hidden.has(l.name)).length;

  return (
    <section className="bc-ec-fab" aria-label="Preview of the files">
      <div className="bc-ec-fab-bar">
        <span role="group" aria-label="Side" className="bc-segmented">
          <Button label="From the top" on={side === "top"} onClick={() => setSide("top")} />
          <Button label="From the bottom" on={side === "bottom"} onClick={() => setSide("bottom")} />
        </span>
        <Button label="Zoom in" onClick={() => setZoom((z) => ({ ...z, k: Math.min(64, z.k * 1.5) }))} />
        <Button label="Zoom out" onClick={() => setZoom((z) => ({ ...z, k: Math.max(0.5, z.k / 1.5) }))} />
        <Button label="Fit" onClick={() => setZoom({ k: 1, x: 0, y: 0 })} />
        <Button
          label="Measure"
          title="Click two points to measure between them"
          on={measure}
          onClick={() => {
            setMeasure(!measure);
            setMarks([]);
          }}
        />
        <label className="bc-ec-fab-open">
          <span className="bc-btn">Open a Gerber zip</span>
          <input
            type="file"
            accept=".zip,application/zip"
            className="bc-sr-only"
            aria-label="Open a Gerber zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void open(f);
            }}
          />
        </label>
      </div>
      <div className="bc-ec-fab-body">
        <canvas
          ref={canvas}
          className="bc-ec-fab-view"
          role="img"
          aria-label={`${own ? "The opened files" : "The files to send"}, seen from the ${side}: ${shown} of ${layers.length} layers shown`}
          onWheel={(e) => setZoom((z) => ({ ...z, k: Math.max(0.5, Math.min(64, z.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2))) }))}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
            if (!d.moved && Math.hypot(dx, dy) < 4) return;
            drag.current = { x: e.clientX, y: e.clientY, moved: true };
            setZoom((z) => ({ ...z, x: z.x + dx, y: z.y + dy }));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved && measure) setMarks((m) => (m.length === 1 ? [m[0]!, at(e)] : [at(e)]));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void open(f);
          }}
          onDragOver={(e) => e.preventDefault()}
        />
        <ul className="bc-ec-fab-layers" aria-label="Layers">
          {layers.map((l) => (
            <li key={l.name}>
              <label>
                <input
                  type="checkbox"
                  checked={!hidden.has(l.name)}
                  onChange={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (!next.delete(l.name)) next.add(l.name);
                      return next;
                    })
                  }
                />
                <span className="bc-ec-fab-dot" style={{ background: `var(--bc-color-${COLOUR[l.kind]})` }} aria-hidden />
                {l.label}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <p className="bc-note" role={bad ? "alert" : "status"}>
        {bad ||
          (length !== null
            ? `${Math.round(length * 1000) / 1000} mm between the two points.`
            : measure
              ? marks.length
                ? "Click the second point."
                : "Click the first point."
              : skipped.length
                ? `This file uses ${skipped.join(" and ")}, which the preview does not draw.`
                : "Drawn from the files themselves, not from your design. Drag to move, scroll to zoom.")}
      </p>
    </section>
  );
}
