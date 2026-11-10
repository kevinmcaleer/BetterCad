import { expect, test } from "@playwright/test";
import { Editor } from "./pages/editor";

/** Tracks run round their wheels as a wheel turns: posing the wheel's joint slides the pieces round the loop. */

type View = { __bcView: { pick(x: number, y: number, f: string): { body: string } | null } };

// Two 40 mm wheels 100 mm apart, a track of 42 pieces round them 22 mm out, and the front wheel on a wheel joint.
const doc = {
  format: "bettercad",
  version: 2,
  name: "Rover track",
  features: [
    {
      id: "fmwbb9t2u1",
      type: "add",
      name: "Cylinder 1",
      part: {
        id: "w1",
        name: "Front wheel",
        kind: "cylinder",
        position: {
          x: 0,
          y: 0,
          z: 0,
        },
        size: {
          x: 20,
          y: 20,
          z: 30,
        },
      },
    },
    {
      id: "fmwbb9t2u2",
      name: "Resize 1",
      parts: ["w1"],
      type: "resize",
      size: {
        x: 40,
        y: 40,
        z: 10,
      },
    },
    {
      id: "fmwbb9t2u3",
      type: "add",
      name: "Cylinder 2",
      part: {
        id: "w2",
        name: "Back wheel",
        kind: "cylinder",
        position: {
          x: 25,
          y: 0,
          z: 0,
        },
        size: {
          x: 20,
          y: 20,
          z: 30,
        },
      },
    },
    {
      id: "fmwbb9t2u4",
      name: "Resize 2",
      parts: ["w2"],
      type: "resize",
      size: {
        x: 40,
        y: 40,
        z: 10,
      },
    },
    {
      id: "fmwbb9t2u5",
      name: "Move 1",
      parts: ["w2"],
      type: "move",
      position: {
        x: 100,
        y: 0,
        z: 0,
      },
    },
    {
      id: "fmwbb9t2v6",
      type: "add",
      name: "Box 1",
      part: {
        id: "link",
        name: "Track piece",
        kind: "box",
        position: {
          x: 50,
          y: 0,
          z: 0,
        },
        size: {
          x: 20,
          y: 20,
          z: 20,
        },
      },
    },
    {
      id: "fmwbb9t2v7",
      name: "Resize 3",
      parts: ["link"],
      type: "resize",
      size: {
        x: 10,
        y: 4,
        z: 2,
      },
    },
    {
      id: "fmwbb9t2v8",
      name: "Move 2",
      parts: ["link"],
      type: "move",
      position: {
        x: 50,
        y: 60,
        z: 4,
      },
    },
    {
      id: "t",
      type: "pattern",
      name: "Pattern 1",
      plane: "YZ",
      offset: 0,
      dir1: "x",
      count1: 3,
      spacing1: 20,
      dir2: "y",
      count2: 1,
      spacing2: 20,
      axis: "z",
      count: 6,
      angle: 360,
      join: false,
      kind: "track",
      parts: ["link"],
      track: {
        count: 42,
        start: {
          body: "link",
          kind: "edge",
          index: 0,
          geo: {
            t: "circle",
            centre: [-4, 0, 1],
            axis: [0, 0, 1],
            radius: 1,
          },
          size: {
            x: 10,
            y: 4,
            z: 2,
          },
        },
        end: {
          body: "link",
          kind: "edge",
          index: 1,
          geo: {
            t: "circle",
            centre: [4, 0, 1],
            axis: [0, 0, 1],
            radius: 1,
          },
          size: {
            x: 10,
            y: 4,
            z: 2,
          },
        },
        wheels: [
          {
            body: "w1",
            kind: "edge",
            index: 0,
            geo: {
              t: "circle",
              centre: [0, 0, 5],
              axis: [0, 0, 1],
              radius: 20,
            },
            size: {
              x: 40,
              y: 40,
              z: 10,
            },
          },
          {
            body: "w2",
            kind: "edge",
            index: 0,
            geo: {
              t: "circle",
              centre: [0, 0, 5],
              axis: [0, 0, 1],
              radius: 20,
            },
            size: {
              x: 40,
              y: 40,
              z: 10,
            },
          },
        ],
        offset: 0,
        lift: 2,
        side: 0,
      },
    },
    {
      id: "W1",
      type: "link",
      name: "Component 1",
      parts: ["w1"],
    },
    {
      id: "Front wheel",
      type: "joint",
      name: "Joint 1",
      kind: "continuous",
      child: "W1",
      parent: null,
      origin: [0, 0, 5],
      axis: [0, 0, 1],
      lower: 0,
      upper: 0,
    },
  ],
  looks: {},
  pose: {},
};

test("turning a wheel runs its track round", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript((text) => {
    const file = { kind: "file", name: "Rover.bcad", getFile: async () => new File([text], "Rover.bcad"), queryPermission: async () => "granted" };
    (window as unknown as Record<string, unknown>).showOpenFilePicker = async () => [file];
  }, JSON.stringify(doc));
  const ed = await new Editor(page).open();
  await page.keyboard.press("ControlOrMeta+o");
  await expect(page.getByText("Opened Rover.bcad")).toBeVisible();
  await ed.kernelReady();
  await ed.view.preset("top");

  const box = (await ed.view.canvas.boundingBox())!;
  const hit = async (x: number, y: number, z: number) => {
    const at = await ed.view.at(x, y, z);
    return page.evaluate((p) => (window as unknown as View).__bcView.pick(p.x, p.y, "body")?.body ?? null, { x: at.x - box.x, y: at.y - box.y });
  };
  // Under the wheels, the track runs along y = -22 mm.
  await expect.poll(() => hit(50, -22, 5)).toMatch(/^(link|t\.)/);
  const before = await hit(50, -22, 5);
  await page.screenshot({ path: test.info().outputPath("track-home.png") });

  // A tenth of a turn: the rim runs about 14 mm, more than a piece, so another piece is there now.
  await page.getByRole("treeitem", { name: /^Front wheel/ }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  const angle = ed.field("Angle");
  await angle.fill("36");
  await angle.press("Enter");
  await expect.poll(() => hit(50, -22, 5)).not.toBe(before);
  expect(await hit(50, -22, 5)).toMatch(/^(link|t\.)/);
  await page.screenshot({ path: test.info().outputPath("track-turned.png") });
});
