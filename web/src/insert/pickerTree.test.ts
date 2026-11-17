import type { Folder, ModelSummary, Project } from "../cloud/api";
import { filterItems, modelOfRow, pickerItems } from "./pickerTree";

const model = (id: string, name: string, where: { folder_id?: string; project_id?: string } = {}): ModelSummary => ({
  id,
  name,
  version: 1,
  created: "",
  modified: "",
  deleted_at: null,
  thumbnail: null,
  folder_id: where.folder_id ?? null,
  project_id: where.project_id ?? null,
});
const folder = (id: string, name: string, where: { parent_id?: string; project_id?: string } = {}): Folder => ({
  id,
  name,
  parent_id: where.parent_id ?? null,
  project_id: where.project_id ?? null,
  created: "",
  modified: "",
  deleted_at: null,
  models: 1,
  folders: 0,
});
const project = (id: string, name: string): Project => ({ id, name, readme: "", cover: null, created: "", modified: "", deleted_at: null, models: 2 });

const tree = { folders: [folder("f1", "Wheels"), folder("f2", "Arm", { project_id: "p1" })], projects: [project("p1", "Rover")] };
const models = [
  model("m1", "Bracket"),
  model("m2", "Wheel 10", { folder_id: "f1" }),
  model("m3", "Chassis", { project_id: "p1" }),
  model("m4", "Gripper", { folder_id: "f2", project_id: "p1" }),
  { ...model("m5", "Old"), deleted_at: "2026-11-01" },
];

describe("model picker tree (#480)", () => {
  it("shows My models, then each project, with their folders before their models", () => {
    const items = pickerItems(tree, models, "m1");
    expect(items.map((i) => [i.name, i.parentId ?? null])).toEqual([
      ["My models", null],
      ["Wheels", "root"],
      ["Wheel 10", "f:f1"],
      ["Bracket", "root"],
      ["Rover", null],
      ["Arm", "p:p1"],
      ["Gripper", "f:f2"],
      ["Chassis", "p:p1"],
    ]);
    // Binned models stay out, places start folded, and the open model says so.
    expect(items.find((i) => i.name === "Bracket")?.note).toBe("Open now");
    expect(items.find((i) => i.name === "Rover")?.folded).toBe(true);
    expect(modelOfRow(items.find((i) => i.name === "Gripper")!.id)).toBe("m4");
    expect(modelOfRow("f:f1")).toBeNull();
  });

  it("searches models by name and keeps the places that hold them, opened", () => {
    const items = filterItems(pickerItems(tree, models), "grip");
    expect(items.map((i) => i.name)).toEqual(["Rover", "Arm", "Gripper"]);
    expect(items.every((i) => !i.folded)).toBe(true);
    expect(filterItems(pickerItems(tree, models), "nothing")).toEqual([]);
  });
});
