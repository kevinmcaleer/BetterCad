/**
 * The plain DXF both exports write: AutoCAD R12 (AC1009) ASCII with $INSUNITS set to millimetres, which almost every
 * program reads. Sketches (`dxf.ts`) and drawings (#569) fill in the entities; this wraps them in the header, the
 * line type and layer tables, and the end of file.
 */
const num = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Group code and value pairs, one per line. */
export class DxfWriter {
  private out: string[] = [];
  pair(code: number, value: string | number): void {
    this.out.push(String(code).padStart(3), typeof value === "number" ? num(value) : value);
  }
  text(): string {
    return this.out.length ? `${this.out.join("\r\n")}\r\n` : "";
  }
}

export interface DxfLayer {
  name: string;
  /** AutoCAD colour index: 7 is black or white, 1 red. */
  colour: number;
  /** A line type from `ltypes`; CONTINUOUS when left out. */
  ltype?: string;
}
export interface DxfLtype {
  name: string;
  description: string;
  /** Dash lengths, mm: positive drawn, negative a gap. */
  pattern: number[];
}

/** A whole DXF file round its entities. Layer "0" is always there. */
export function dxfFile(
  ents: DxfWriter,
  box: { min: readonly [number, number]; max: readonly [number, number] },
  layers: DxfLayer[],
  ltypes: DxfLtype[] = [],
): string {
  const w = new DxfWriter();
  w.pair(0, "SECTION");
  w.pair(2, "HEADER");
  w.pair(9, "$ACADVER");
  w.pair(1, "AC1009");
  // 4: millimetres. $MEASUREMENT 1: metric.
  w.pair(9, "$INSUNITS");
  w.pair(70, 4);
  w.pair(9, "$MEASUREMENT");
  w.pair(70, 1);
  w.pair(9, "$EXTMIN");
  w.pair(10, box.min[0]);
  w.pair(20, box.min[1]);
  w.pair(30, 0);
  w.pair(9, "$EXTMAX");
  w.pair(10, box.max[0]);
  w.pair(20, box.max[1]);
  w.pair(30, 0);
  w.pair(0, "ENDSEC");

  w.pair(0, "SECTION");
  w.pair(2, "TABLES");
  w.pair(0, "TABLE");
  w.pair(2, "LTYPE");
  w.pair(70, 1 + ltypes.length);
  w.pair(0, "LTYPE");
  w.pair(2, "CONTINUOUS");
  w.pair(70, 0);
  w.pair(3, "Solid line");
  w.pair(72, 65);
  w.pair(73, 0);
  w.pair(40, 0);
  for (const t of ltypes) {
    w.pair(0, "LTYPE");
    w.pair(2, t.name);
    w.pair(70, 0);
    w.pair(3, t.description);
    w.pair(72, 65);
    w.pair(73, t.pattern.length);
    w.pair(
      40,
      t.pattern.reduce((s, d) => s + Math.abs(d), 0),
    );
    for (const d of t.pattern) w.pair(49, d);
  }
  w.pair(0, "ENDTAB");
  w.pair(0, "TABLE");
  w.pair(2, "LAYER");
  w.pair(70, 1 + layers.length);
  for (const l of [{ name: "0", colour: 7 } as DxfLayer, ...layers]) {
    w.pair(0, "LAYER");
    w.pair(2, l.name);
    w.pair(70, 0);
    w.pair(62, l.colour);
    w.pair(6, l.ltype ?? "CONTINUOUS");
  }
  w.pair(0, "ENDTAB");
  w.pair(0, "ENDSEC");

  w.pair(0, "SECTION");
  w.pair(2, "ENTITIES");
  const tail = new DxfWriter();
  tail.pair(0, "ENDSEC");
  tail.pair(0, "EOF");
  return w.text() + ents.text() + tail.text();
}
