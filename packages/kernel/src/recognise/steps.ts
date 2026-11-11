import { addConvert, addHole, addLink, newId, setLook, type ModelDoc } from "../document";
import type { Recognition } from "./index";
import { groupHoles } from "./holes";

export type { Recognition, FoundHole, HoleGroup, V3 } from "./index";

/**
 * The steps that make a recognised mesh editable (#448, #449): a component named after the mesh, a Convert step that
 * makes a new body in it with the chosen holes filled, and a Hole step for each run of like holes on one face. The
 * mesh itself stays, hidden.
 */
export interface ConvertChoice {
  /** The mesh body, and its name. */
  part: string;
  name: string;
  /** Which of the found holes become Hole steps; the rest stay as they are in the mesh. */
  holes: boolean[];
  /** The component being worked in, which the new one goes inside. */
  parent?: string;
}

const tidy = (v: number, places = 3) => {
  const k = 10 ** places;
  return Math.round(v * k) / k + 0;
};

export function addConverted(
  doc: ModelDoc,
  at: number | undefined,
  r: Recognition,
  c: ConvertChoice,
): { doc: ModelDoc; body: string; component: string; steps: number } {
  const chosen = r.holes.filter((h, i) => c.holes[i] && h.step);
  const component = newId("f");
  const body = newId();
  const name = `${c.name} (editable)`;
  let d = addLink(doc, [], component, at, c.parent, name);
  let next = at === undefined ? undefined : at + 1;
  const step = () => {
    const i = next;
    if (next !== undefined) next++;
    return i;
  };
  d = addConvert(d, { part: c.part, body: { id: body, name }, plugs: chosen.flatMap((h) => h.plugs), component }, newId("f"), step());
  const groups = groupHoles(chosen);
  for (const g of groups) {
    const head = g.head;
    d = addHole(
      d,
      {
        part: body,
        frame: { origin: g.frame.origin.map((v) => tidy(v, 6)) as never, x: g.frame.x as never, normal: g.frame.normal as never },
        points: g.points.map(([x, y]) => [tidy(x, 4), tidy(y, 4)]),
        size: "custom",
        fit: "normal",
        diameter: tidy(g.diameter),
        head: head?.kind ?? "none",
        ...(head ? { headSize: { diameter: tidy(head.diameter), depth: tidy(head.depth), ...(head.angle ? { angle: tidy(head.angle, 1) } : {}) } } : {}),
        depth: g.depth === null ? null : tidy(g.depth),
        component,
      },
      newId("f"),
      step(),
    );
  }
  // The mesh stays in the model with its eye off: show it to compare, or delete the Convert step to go back to it.
  d = setLook(d, [c.part], () => ({ hidden: true }));
  return { doc: d, body, component, steps: 2 + groups.length };
}
