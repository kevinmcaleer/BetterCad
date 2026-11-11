import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FoundHole, Recognition } from "@bettercad/kernel/recognise";
import { addImport, newDoc, type ModelDoc } from "../state/document";
import { RecogniseTool, type RecogniseToolProps } from "./RecogniseTool";
import { groupText, leftText } from "./holeText";

const hole = (x: number, y: number, more: Partial<FoundHole> = {}): FoundHole => ({
  origin: [x, y, 5],
  normal: [0, 0, 1],
  diameter: 3.4,
  depth: null,
  step: true,
  match: "M3 clearance",
  plugs: [{ origin: [x, y, 5], axis: [0, 0, -1], radius: 1.71, length: 5 }],
  ...more,
});
const holes: FoundHole[] = [
  hole(5, 5),
  hole(35, 5),
  hole(20, 10, { diameter: 6, depth: 3, match: undefined }),
  hole(20, 20, { diameter: 4, step: false, note: "It has more than one step", match: undefined, plugs: [] }),
];
const frame = { origin: [0, 0, 5] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
const found = (more: Partial<Recognition & { open: boolean }> = {}): Recognition & { open: boolean } => ({
  triangles: 400,
  openEdges: 0,
  manyEdges: 0,
  size: 45,
  tol: 0.01,
  planes: 6,
  freeform: 0,
  coverage: 1,
  faces: [],
  edges: [],
  holes,
  groups: [
    {
      frame,
      points: [
        [5, 5],
        [35, 5],
      ],
      diameter: 3.4,
      depth: null,
      match: "M3 clearance",
      holes: [0, 1],
    },
    { frame, points: [[20, 10]], diameter: 6, depth: 3, holes: [2] },
  ],
  open: false,
  ...more,
});

function start(result: (Recognition & { open: boolean }) | Error = found()) {
  const doc = addImport(
    newDoc(),
    { file: "plate.stl", format: "stl", blob: "b", data: "", bodies: [{ id: "mesh", name: "plate" }], position: { x: 0, y: 0, z: 0 } },
    "f1",
    undefined,
  );
  let made: ModelDoc | null = null;
  const props: RecogniseToolProps = {
    part: { id: "mesh", name: "plate" },
    doc,
    call: vi.fn(() => Object.assign(result instanceof Error ? Promise.reject(result) : Promise.resolve(result), { cancel: vi.fn() })) as never,
    record: vi.fn((fn) => {
      made = fn(doc, undefined);
    }),
    say: vi.fn(),
    view: { current: null },
    select: vi.fn(),
    onClose: vi.fn(),
  };
  render(<RecogniseTool {...props} />);
  return { props, made: () => made };
}

describe("RecogniseTool", () => {
  it("lists the holes it found in runs, ticked, with the ones it leaves and why", async () => {
    start();
    const list = await screen.findByRole("list", { name: "Holes found" });
    const boxes = within(list).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(within(list).getByRole("checkbox", { name: "2 × 3.4 mm holes, through, M3 clearance" })).toBeChecked();
    expect(within(list).getByRole("checkbox", { name: "6 mm hole, 3 mm deep" })).toBeChecked();
    expect(screen.getByRole("list", { name: "Holes left as they are" })).toHaveTextContent("4 mm hole, through: It has more than one step");
    expect(screen.getByText("6 flat faces and 0 round faces recognised, 100% of the surface.")).toBeInTheDocument();
  });

  it("converts the ticked holes into a component with a Convert step and Hole steps, and hides the mesh", async () => {
    const user = userEvent.setup();
    const { props, made } = start();
    await user.click(await screen.findByRole("checkbox", { name: "6 mm hole, 3 mm deep" }));
    await user.click(screen.getByRole("button", { name: /Convert/ }));
    const d = made()!;
    expect(d.features.map((f) => f.type)).toEqual(["import", "link", "convert", "hole"]);
    const convert = d.features.find((f) => f.type === "convert")!;
    expect(convert.type === "convert" && convert.plugs).toHaveLength(2);
    expect(d.looks?.mesh?.hidden).toBe(true);
    expect(props.say).toHaveBeenCalledWith("plate is now editable, with 2 holes you can change. The mesh is hidden.");
    expect(props.select).toHaveBeenCalledWith([convert.type === "convert" ? convert.body.id : ""]);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("won't convert with nothing ticked", async () => {
    const user = userEvent.setup();
    start();
    for (const box of await screen.findAllByRole("checkbox")) await user.click(box);
    expect(screen.getByRole("button", { name: /Convert/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("says when the mesh has gaps, is sculpted, or can't be read", async () => {
    start(found({ open: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This mesh has gaps, so it can't be converted.");
    expect(screen.getByRole("button", { name: /Convert/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("says when most of the mesh is sculpted", async () => {
    start(found({ coverage: 0.2, holes: [], groups: [] }));
    expect(await screen.findByText(/Most of this mesh is sculpted/)).toBeInTheDocument();
    expect(screen.getByText(/No holes found/)).toBeInTheDocument();
  });

  it("shows why a mesh could not be read", async () => {
    start(new Error("Recognise features reads a body as it was imported. Use it before other steps change the body."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use it before other steps change the body.");
  });

  it("asks again when the roughness changes", async () => {
    const user = userEvent.setup();
    const { props } = start();
    await screen.findByRole("list", { name: "Holes found" });
    await user.click(screen.getByRole("button", { name: "Rough" }));
    expect(props.call).toHaveBeenLastCalledWith("recognise", expect.objectContaining({ body: "mesh", rough: 1 }));
  });
});

describe("hole text", () => {
  it("names heads and screws", () => {
    expect(groupText({ frame, points: [[0, 0]], diameter: 3.4, depth: null, head: { kind: "counterbore", diameter: 6.5, depth: 3 }, holes: [0] })).toBe(
      "3.4 mm hole, through, counterbore 6.5 mm",
    );
    expect(leftText(holes[3]!)).toBe("4 mm hole, through: It has more than one step");
  });
});
