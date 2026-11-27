/**
 * The starter plug-ins (#764), so you can see what a script is for. Each is plain JavaScript using `bc`; they ship
 * as `.bcplugin.js` files you can open, read and copy.
 */
export interface Plugin {
  name: string;
  description: string;
  source: string;
}

export const STARTER_PLUGINS: Plugin[] = [
  {
    name: "Ring of LEDs",
    description: "Place the LEDs on the board evenly round a circle",
    source: `// Set these to suit your board, in mm.
const centre = [25, 20];
const radius = 15;

const board = bc.board();
if (!board) throw new Error("Push the schematic to a PCB first");
const onBoard = new Set(board.placements.map((p) => p.ref));
const leds = bc.parts().filter((p) => p.prefix === "D" && /led/i.test(p.name) && onBoard.has(p.ref));
if (!leds.length) throw new Error("There are no LEDs on the board");
leds.forEach((led, i) => {
  const turn = (360 * i) / leds.length;
  const a = (turn * Math.PI) / 180;
  bc.move(led.ref, [centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)], turn + 90);
});
bc.say("Placed", leds.length, "LEDs round a circle of", radius, "mm");
`,
  },
  {
    name: "Same value for all",
    description: "Give every part whose reference matches one value, such as every C to 100 nF",
    source: `// Which parts: a reference pattern, with * for any number, or a list such as R1-R8.
const pattern = "C*";
const value = "100 nF";

const range = /^([A-Z]+)(\\d+)-[A-Z]*(\\d+)$/i.exec(pattern);
const matches = (ref) => {
  if (range) {
    const m = /^([A-Z]+)(\\d+)$/i.exec(ref);
    return !!m && m[1].toUpperCase() === range[1].toUpperCase() && +m[2] >= +range[2] && +m[2] <= +range[3];
  }
  return new RegExp("^" + pattern.replace(/[^A-Za-z0-9*]/g, "").replace(/\\*/g, "\\\\d+") + "$", "i").test(ref);
};
const parts = bc.parts().filter((p) => matches(p.ref) && p.value !== value);
for (const p of parts) bc.setValue(p.ref, value);
bc.say(parts.length ? "Set " + parts.map((p) => p.ref).join(", ") + " to " + value : "Every matching part is " + value + " already");
`,
  },
  {
    name: "Supplier parts list",
    description: "Write the parts list as a CSV file, in the columns you name",
    source: `// The columns, in order: ref, value, name, package, mpn, lcsc, manufacturer, quantity.
const columns = ["quantity", "value", "package", "mpn", "ref"];
const name = "parts-list.csv";

// One row per value and package, with its references and how many.
const groups = new Map();
for (const p of bc.parts().filter((p) => p.fitted)) {
  const key = [p.value, p.package, p.mpn].join("|");
  if (!groups.has(key)) groups.set(key, { ...p, refs: [] });
  groups.get(key).refs.push(p.ref);
}
const cell = (v) => (/[",\\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const rows = [...groups.values()].map((g) => columns.map((c) => (c === "ref" ? g.refs.join(" ") : c === "quantity" ? g.refs.length : g[c] ?? "")));
bc.table([columns, ...rows]);
bc.file(name, [columns, ...rows].map((r) => r.map(cell).join(",")).join("\\n") + "\\n");
bc.say(rows.length, "lines for", bc.parts().filter((p) => p.fitted).length, "parts");
`,
  },
];

/** A plug-in kept in your library (#764). */
export interface OwnPlugin extends Plugin {
  id: string;
  /** When it was last saved, in ms: of two copies, the later one is kept. */
  at: number;
}

/** What a `.bcplugin.js` file starts with: a marker, then its name and description as comments. */
const HEAD = "// @bcplugin";

/** A plug-in as a file to keep or pass on. The file is the script itself, readable and runnable as it is. */
export function pluginFile(p: Plugin): string {
  const one = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  return `${HEAD}\n// @name ${one(p.name)}\n// @description ${one(p.description)}\n${p.source.endsWith("\n") ? p.source : `${p.source}\n`}`;
}

/** Reads a `.bcplugin.js` file (or any script): its name and description from the header, or from the file's name. */
export function readPluginFile(text: string, fileName = "Plug-in"): Plugin {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let name = fileName.replace(/\.bcplugin\.js$|\.js$/i, "") || "Plug-in";
  let description = "";
  let i = 0;
  if (lines[0]?.trim() === HEAD) {
    i = 1;
    for (; i < lines.length; i += 1) {
      const m = /^\/\/\s*@(name|description)\s+(.*)$/.exec(lines[i]!);
      if (!m) break;
      if (m[1] === "name") name = m[2]!.trim() || name;
      else description = m[2]!.trim();
    }
  }
  return { name: name.slice(0, 80), description: description.slice(0, 200), source: lines.slice(i).join("\n") };
}
