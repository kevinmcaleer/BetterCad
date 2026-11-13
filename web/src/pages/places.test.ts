import type { Folder, Project } from "../cloud/api";
import { crumbs, foldersIn, hashOf, keyOf, placeName, placeOf, targets, within, type Tree } from "./places";
import { readmeBlocks } from "./Readme";

const folder = (id: string, name: string, parent_id: string | null = null, project_id: string | null = null): Folder => ({
  id,
  name,
  parent_id,
  project_id,
  created: "",
  modified: "",
  deleted_at: null,
  models: 0,
  folders: 0,
});
const project = (id: string, name: string): Project => ({ id, name, readme: "", cover: null, created: "", modified: "", deleted_at: null, models: 0 });

// My models: Parts, Parts/Bolts. Rover: Arm, Arm/Gripper.
const tree: Tree = {
  folders: [folder("parts", "Parts"), folder("bolts", "Bolts", "parts"), folder("arm", "Arm", null, "rover"), folder("grip", "Gripper", "arm", "rover")],
  projects: [project("rover", "Rover")],
};

describe("folders and projects", () => {
  it("names the way back up from a folder in a project", () => {
    expect(crumbs(tree, { kind: "folder", id: "grip" }).map((c) => c.name)).toEqual(["My models", "Rover", "Arm", "Gripper"]);
    expect(crumbs(tree, { kind: "folder", id: "bolts" }).map((c) => c.name)).toEqual(["My models", "Parts", "Bolts"]);
    expect(crumbs(tree, { kind: "project", id: "rover" }).map((c) => c.name)).toEqual(["My models", "Rover"]);
    expect(crumbs(tree, { kind: "root" }).map((c) => c.name)).toEqual(["My models"]);
  });

  it("lists the folders directly inside a place", () => {
    expect(foldersIn(tree, { kind: "root" }).map((f) => f.id)).toEqual(["parts"]);
    expect(foldersIn(tree, { kind: "project", id: "rover" }).map((f) => f.id)).toEqual(["arm"]);
    expect(foldersIn(tree, { kind: "folder", id: "arm" }).map((f) => f.id)).toEqual(["grip"]);
  });

  it("says where a model lives", () => {
    expect(placeName(tree, { folder_id: "grip", project_id: "rover" })).toBe("Rover / Arm / Gripper");
    expect(placeName(tree, { project_id: "rover" })).toBe("Rover");
    expect(placeName(tree, {})).toBe("My models");
  });

  it("puts new things where you are, with the folder's project", () => {
    expect(placeOf(tree, { kind: "folder", id: "grip" })).toEqual({ folder_id: "grip", project_id: "rover" });
    expect(placeOf(tree, { kind: "project", id: "rover" })).toEqual({ project_id: "rover" });
    expect(placeOf(tree, { kind: "root" })).toEqual({});
    expect(hashOf({ kind: "folder", id: "a b" })).toBe("#/library/folder/a%20b");
  });

  it("offers every place to move to, in tree order, and knows what's inside a folder", () => {
    expect(targets(tree).map((t) => `${"  ".repeat(t.depth)}${t.name}`)).toEqual(["My models", "  Parts", "    Bolts", "Rover", "  Arm", "    Gripper"]);
    expect([...within(tree, "arm")].sort()).toEqual(["arm", "grip"]);
    expect(keyOf({ folder_id: "arm", project_id: "rover" })).toBe("f:arm");
    expect(keyOf({ project_id: "rover" })).toBe("p:rover");
  });
});

describe("project readme", () => {
  it("reads headings, lists and paragraphs", () => {
    expect(readmeBlocks("# Rover\n\nSix wheels\nand an arm.\n- Chassis\n- Arm\n\n## Parts")).toEqual([
      { kind: "h", level: 1, text: "Rover" },
      { kind: "p", text: "Six wheels and an arm." },
      { kind: "ul", items: ["Chassis", "Arm"] },
      { kind: "h", level: 2, text: "Parts" },
    ]);
  });
});
