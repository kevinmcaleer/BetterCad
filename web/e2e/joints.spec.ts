import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/** Joints (#172): a box made a link, hung from Base on a hinge about its top face, then made a slider. */
test("hang a link from Base on a hinge, back out a pick with Esc, then make it a slider", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click();
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Make link/ }).click();
  await expect(page.getByText("Made Link 1 of 1 body")).toBeVisible();

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  // A body in Base can't move on its own.
  await click(page, 0, 0, 20);
  await expect(page.getByText(/That body is in Base/)).toBeVisible();
  await click(page, 25, 0, 20);
  await expect(page.getByText("Moves: Link 1")).toBeVisible();
  // Esc backs out the pick, then pick it again.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Moves: Link 1")).toHaveCount(0);
  await click(page, 25, 0, 20);
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.getByText("Hangs from: Base")).toBeVisible();
  await click(page, 25, 0, 20);

  await expect(page.getByRole("button", { name: "Hinge (revolute)", pressed: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Lower" })).toHaveValue("-90");
  await page.getByRole("button", { name: "Slider (prismatic)" }).click();
  await expect(page.getByRole("textbox", { name: "Upper" })).toHaveValue("50");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made Joint 1: slider, Link 1 on Base")).toBeVisible();

  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /^Link 1.*slider on Joint 1/ })).toBeVisible();
});

/** Posing (#173): a hinge turned with its slider, kept through undo, and sent home. */
test("pose a hinge with its slider and send it home", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Make link/ }).click();
  await expect(page.getByText("Made Link 1 of 1 body")).toBeVisible();
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  await click(page, 25, 0, 20);
  await expect(page.getByText("Moves: Link 1")).toBeVisible();
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.getByText("Hangs from: Base")).toBeVisible();
  await click(page, 25, 0, 20);
  await expect(page.getByRole("button", { name: "Hinge (revolute)", pressed: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();

  // With the link's body selected, Properties shows its joint.
  const props = page.getByRole("complementary", { name: "Properties" });
  const joint = props.getByRole("group", { name: "Joint 1, hinge" });
  await expect(joint).toBeVisible();
  const slider = joint.getByRole("slider", { name: "Angle" });
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(joint.getByRole("textbox", { name: /^Angle/ })).toHaveValue("5");
  await expect(page.getByRole("button", { name: /^Undo move joint 1/i })).toBeVisible();
  // Typed past the limit, it stops at the limit.
  await joint.getByRole("textbox", { name: /^Angle/ }).fill("120");
  await page.keyboard.press("Enter");
  await expect(joint.getByRole("textbox", { name: /^Angle/ })).toHaveValue("90");

  // With nothing selected, the model's summary poses every joint and sends them home.
  await page.keyboard.press("Escape");
  await expect(props.getByRole("heading", { name: "Pose" })).toBeVisible();
  await props.getByRole("button", { name: "Home" }).click();
  await expect(joint.getByRole("textbox", { name: /^Angle/ })).toHaveValue("0");
  await expect(page.getByText("The joints are home")).toBeVisible();
});

/** Posing (#173): drag a link round its hinge in the view, snapping to 5°; Esc mid-drag puts it back. */
test("drag a link round its hinge in the view, and Esc puts it back", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Make link/ }).click();
  await expect(page.getByText("Made Link 1 of 1 body")).toBeVisible();
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  await click(page, 25, 0, 20);
  await expect(page.getByText("Moves: Link 1")).toBeVisible();
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.getByText("Hangs from: Base")).toBeVisible();
  // The top face: a hinge about Z through (25, 0, 20).
  await click(page, 25, 0, 20);
  await expect(page.getByRole("button", { name: "Hinge (revolute)", pressed: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const at = async (p: number[]) => {
    const q = await page.evaluate((v) => (window as unknown as View).__bcView.project(v), p);
    return { x: box.x + q.x, y: box.y + q.y };
  };
  const angle = page.getByRole("complementary", { name: "Properties" }).getByRole("textbox", { name: /^Angle/ });
  // Round the hinge from +X to 45° anticlockwise, seen from above.
  const r = 8;
  const path = [0, 15, 30, 45].map((d) => [25 + r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180), 20]);
  const from = await at(path[0]!);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const p of path.slice(1)) {
    const q = await at(p);
    await page.mouse.move(q.x, q.y, { steps: 4 });
  }
  await page.mouse.up();
  await expect(angle).toHaveValue("45");

  // Another drag, called off with Esc.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const q = await at([25, -r, 20]);
  await page.mouse.move(q.x, q.y, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByText("Put Joint 1 back")).toBeVisible();
  await expect(angle).toHaveValue("45");
});

/** URDF (#175): a box hung from Base on a hinge, exported as a .zip with the .urdf and a mesh per link. */
test("export the robot as URDF", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showOpenFilePicker = async () => [];
    w.showSaveFilePicker = async (o: { suggestedName: string }) => ({
      kind: "file",
      name: o.suggestedName,
      createWritable: async () => ({
        write: async (d: Blob) => {
          w.__export = { name: o.suggestedName, text: new TextDecoder("latin1").decode(await d.arrayBuffer()) };
        },
        close: async () => {},
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Make link/ }).click();
  await expect(page.getByText("Made Link 1 of 1 body")).toBeVisible();
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  await click(page, 25, 0, 20);
  await expect(page.getByText("Moves: Link 1")).toBeVisible();
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.getByText("Hangs from: Base")).toBeVisible();
  await click(page, 25, 0, 20);
  await expect(page.getByRole("button", { name: "Hinge (revolute)", pressed: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("button", { name: "URDF" }).click();
  await expect(dialog.getByRole("group", { name: "What" })).toHaveCount(0);
  await expect(dialog.getByRole("status")).toHaveText(/^2 meshes · ≈ 24 triangles/, { timeout: 60_000 });
  await dialog.getByRole("checkbox", { name: /ROS package/ }).check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByText(/^Exported .*\.zip$/)).toBeVisible({ timeout: 30_000 });
  const out = await page.evaluate(() => (window as unknown as { __export: { name: string; text: string } }).__export);
  expect(out.name).toMatch(/\.zip$/);
  // Stored, not compressed, so the .urdf reads straight out of the .zip.
  expect(out.text).toContain('<joint name="Joint_1" type="revolute">');
  expect(out.text).toContain('<child link="Link_1"/>');
  expect(out.text).toMatch(/<mesh filename="package:\/\/\w+\/meshes\/Link_1\.stl"\/>/);
  expect(out.text).toContain("/meshes/base_link.stl");
});

/** Drive links (#194): two hinges linked at 1:2, so turning one turns the other, and Play runs it until Esc. */
test("drive one hinge from another, and play it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  for (const [box, link] of [
    ["Box 2", "Link 1"],
    ["Box 1", "Link 2"],
  ] as const) {
    await page.getByRole("treeitem", { name: new RegExp(`^${box}`) }).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Make link/ }).click();
    await expect(page.getByText(`Made ${link} of 1 body`)).toBeVisible();
  }
  for (const [x, link, joint] of [
    [25, "Link 1", "Joint 1"],
    [0, "Link 2", "Joint 2"],
  ] as const) {
    await page
      .getByRole("toolbar", { name: "Model tools" })
      .getByRole("button", { name: /^Joint/ })
      .click();
    await click(page, x, 0, 20);
    await expect(page.getByText(`Moves: ${link}`)).toBeVisible();
    await page.getByRole("button", { name: "Base", exact: true }).click();
    await expect(page.getByText("Hangs from: Base")).toBeVisible();
    await click(page, x, 0, 20);
    await expect(page.getByRole("button", { name: "Hinge (revolute)", pressed: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("treeitem", { name: new RegExp(`^${joint}`) })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  await page.keyboard.type("Drive link");
  await page.getByRole("option", { name: /Drive link/ }).click();
  const dialog = page.getByRole("dialog", { name: "Drive link" });
  await expect(dialog.getByRole("combobox", { name: "Driver" })).toHaveValue(/.+/);
  await dialog.getByRole("button", { name: "Custom" }).click();
  await dialog.getByRole("textbox", { name: /^Ratio/ }).fill("0.5");
  await dialog.getByRole("textbox", { name: /^Ratio/ }).press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("0.5×, the same way");
  await dialog.getByRole("button", { name: "Add drive" }).click();
  await expect(page.getByText("Added Drive 1. Move either joint and the other follows.")).toBeVisible();

  const props = page.getByRole("complementary", { name: "Properties" });
  const one = props.getByRole("group", { name: "Joint 1, hinge" });
  const two = props.getByRole("group", { name: "Joint 2, hinge" });
  await expect(two.getByText("Driven by Joint 1")).toBeVisible();
  await one.getByRole("textbox", { name: /^Angle/ }).fill("40");
  await one.getByRole("textbox", { name: /^Angle/ }).press("Enter");
  await expect(two.getByRole("textbox", { name: /^Angle/ })).toHaveValue("20");
  // Moving the driven one moves its driver.
  await two.getByRole("textbox", { name: /^Angle/ }).fill("-10");
  await two.getByRole("textbox", { name: /^Angle/ }).press("Enter");
  await expect(one.getByRole("textbox", { name: /^Angle/ })).toHaveValue("-20");

  await one.getByRole("button", { name: "Play" }).click();
  await expect(page.getByText("Playing Joint 1. Esc stops.")).toBeVisible();
  await expect(one.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(one.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(one.getByRole("textbox", { name: /^Angle/ })).toHaveValue("-20");
});

/** Inverse kinematics (#176): a tool point on a link, dragged, turns the hinge it hangs on; Esc mid-drag puts it back. */
test("drag an arm by its tool point", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Make link/ }).click();
  await expect(page.getByText("Made Link 1 of 1 body")).toBeVisible();
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  await click(page, 25, 0, 20);
  await expect(page.getByText("Moves: Link 1")).toBeVisible();
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await expect(page.getByText("Hangs from: Base")).toBeVisible();
  await click(page, 25, 0, 20);
  await expect(page.getByRole("button", { name: "Hinge (revolute)", pressed: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  await page.keyboard.type("Set tool point");
  await page.getByRole("option", { name: /Set tool point/ }).click();
  await expect(page.getByText("Click a point on a link to drag the arm by. Esc cancels.")).toBeVisible();
  await click(page, 33, 0, 20);
  await expect(page.getByText("Set the tool point on Link 1. Drag Link 1 to move the arm.")).toBeVisible();

  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const at = async (p: number[]) => {
    const q = await page.evaluate((v) => (window as unknown as View).__bcView.project(v), p);
    return { x: box.x + q.x, y: box.y + q.y };
  };
  const angle = page.getByRole("complementary", { name: "Properties" }).getByRole("textbox", { name: /^Angle/ });
  await expect(angle).toHaveValue("0");
  // Drag the link a quarter turn round the hinge, by a point clear of the gizmo on the tool point: the tool point
  // keeps its offset from the pointer.
  const tool = await at([33, 0, 20]);
  const from = await at([29, -5, 20]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const d of [20, 45, 70, 90]) {
    const q = await at([25 + 8 * Math.cos((d * Math.PI) / 180), 8 * Math.sin((d * Math.PI) / 180), 20]);
    await page.mouse.move(q.x + from.x - tool.x, q.y + from.y - tool.y, { steps: 3 });
  }
  await page.mouse.up();
  await expect.poll(async () => Number(await angle.inputValue())).toBeGreaterThan(60);
  await expect(page.getByRole("button", { name: /^Undo move the arm/i })).toBeVisible();

  // Another drag, called off with Esc.
  const kept = await angle.inputValue();
  const start = await at([25, 8, 20]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const q = await at([25, -8, 20]);
  await page.mouse.move(q.x, q.y, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByText("Put the arm back")).toBeVisible();
  await expect(angle).toHaveValue(kept);

  // The gizmo on the tool point: its X arrow holds the drag to X, so the arm swings back towards the X axis.
  const tip = await at([25, 8, 20]);
  const ahead = await at([26, 8, 20]);
  const len = Math.hypot(ahead.x - tip.x, ahead.y - tip.y);
  const dir = { x: (ahead.x - tip.x) / len, y: (ahead.y - tip.y) / len };
  const grab = { x: tip.x + dir.x * 45, y: tip.y + dir.y * 45 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dir.x * 40, grab.y + dir.y * 40, { steps: 4 });
  await page.mouse.move(grab.x + dir.x * 120, grab.y + dir.y * 120, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await angle.inputValue())).toBeLessThan(Number(kept) - 10);
});
