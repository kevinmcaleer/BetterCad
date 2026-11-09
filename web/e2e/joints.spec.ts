import { expect, test, type Page } from "@playwright/test";

type View = { __bcView: { project(p: number[]): { x: number; y: number } } };

async function click(page: Page, x: number, y: number, z: number) {
  const box = (await page.getByTestId("view-canvas").boundingBox())!;
  const q = await page.evaluate((p) => (window as unknown as View).__bcView.project(p), [x, y, z]);
  await page.mouse.move(box.x + q.x, box.y + q.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * The Joint tool: hangs `link` from Base on a hinge about Z through the middle of its box's top at (x, 0, 20) (or the
 * Z axis, for the box on it), picked on the box itself, so the box stays where it is.
 */
async function hingeOnBase(page: Page, link: string, x: number) {
  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  const panel = page.getByRole("group", { name: "Joint options" });
  await panel.getByRole("combobox", { name: "The component that moves" }).selectOption({ label: link });
  await expect(panel.getByText(`Moves: ${link}`)).toBeVisible();
  await panel.getByRole("button", { name: "Base", exact: true }).click();
  await expect(panel.getByText("Hangs from: Base")).toBeVisible();
  await click(page, x, 0, 20);
  await expect(panel.getByRole("region", { name: "Hangs from" }).getByRole("button", { name: /^-?[\d.]+, -?[\d.]+, -?[\d.]+ mm/ })).toBeVisible();
}

/** Joints (#172): a box made a component, snapped onto a Base box with every field in one panel, then made a slider. */
test("snap a component onto Base in the joint panel, back out a pick with Esc, then make it a slider", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click();
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await expect(page.getByText("Made Component 1 of 1 body")).toBeVisible();

  await page
    .getByRole("toolbar", { name: "Model tools" })
    .getByRole("button", { name: /^Joint/ })
    .click();
  // A body in Base can't move on its own.
  await click(page, 0, 0, 20);
  await expect(page.getByText(/That body is in Base/)).toBeVisible();
  await click(page, 25, 0, 20);
  await expect(page.getByText("Moves: Component 1")).toBeVisible();
  // Esc backs out the pick, then pick it again.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Moves: Component 1")).toHaveCount(0);
  // Every field is in the one panel: each component with its snap, how it moves and how it lines up.
  const panel = page.getByRole("group", { name: "Joint options" });
  const moves = panel.getByRole("region", { name: "Moves" });
  const from = panel.getByRole("region", { name: "Hangs from" });
  await click(page, 25, 0, 20);
  await expect(moves.getByRole("button", { name: /^25, 0, 20 mm/ })).toBeVisible();
  // The other snap, on Box 1's top (clear of the Z axis, which would give the axis itself): Box 1 is in Base, so it
  // hangs from Base, and Box 2 turns over onto it.
  await click(page, 8, 8, 20);
  await expect(from.getByText("Hangs from: Base")).toBeVisible();
  await expect(from.getByRole("button", { name: /^0, 0, 20 mm/ })).toBeVisible();
  await expect(from.getByRole("combobox", { name: "The component it hangs from" })).toHaveValue("base");
  for (const field of ["Angle", "Gap", "X offset", "Y offset", "Z offset"]) await expect(panel.getByRole("textbox", { name: field })).toHaveValue("0");
  await expect(panel.getByRole("checkbox", { name: "Flip" })).not.toBeChecked();
  await panel.getByRole("textbox", { name: "Angle" }).fill("15");
  await panel.getByRole("textbox", { name: "Angle" }).press("Tab");
  await expect(panel.getByRole("textbox", { name: "Angle" })).toHaveValue("15");
  await expect(panel.getByRole("combobox", { name: "Kind" })).toHaveValue("revolute");
  await expect(panel.getByRole("textbox", { name: "Lower" })).toHaveValue("-90");
  await panel.getByRole("combobox", { name: "Kind" }).selectOption({ label: "Slider (prismatic)" });
  await expect(panel.getByRole("textbox", { name: "Upper" })).toHaveValue("50");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Made Joint 1: slider, Component 1 on Base")).toBeVisible();
  await expect(panel).toHaveCount(0);
  // A double-click on the timeline opens the same panel, with every field as it was left.
  await page.getByRole("button", { name: /^Joint 1, Slider/ }).dblclick();
  const editing = page.getByRole("group", { name: "Edit Joint 1 options" });
  await expect(editing.getByRole("region", { name: "Moves" }).getByRole("button", { name: /^25, 0, 20 mm/ })).toBeVisible();
  await expect(editing.getByRole("region", { name: "Hangs from" }).getByRole("button", { name: /^0, 0, 20 mm/ })).toBeVisible();
  await expect(editing.getByRole("textbox", { name: "Angle" })).toHaveValue("15");
  await expect(editing.getByRole("combobox", { name: "Kind" })).toHaveValue("prismatic");
  await editing.getByRole("button", { name: "Cancel" }).click();
  await expect(editing).toHaveCount(0);

  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Component 1$/ })).toBeVisible();
  // A joint's eye hides its arrow, not the component it moves, and the Joints folder's eye follows.
  await page.getByRole("button", { name: "Hide Joint 1" }).click();
  await expect(page.getByRole("button", { name: "Show Joint 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Joints" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide Component 1" })).toBeVisible();
  await page.getByRole("button", { name: "Show Joints" }).click();
  await expect(page.getByRole("button", { name: "Hide Joint 1" })).toBeVisible();
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
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await expect(page.getByText("Made Component 1 of 1 body")).toBeVisible();
  await hingeOnBase(page, "Component 1", 25);
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
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await expect(page.getByText("Made Component 1 of 1 body")).toBeVisible();
  // The top face: a hinge about Z through (25, 0, 20).
  await hingeOnBase(page, "Component 1", 25);
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
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await expect(page.getByText("Made Component 1 of 1 body")).toBeVisible();
  await hingeOnBase(page, "Component 1", 25);
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
  expect(out.text).toContain('<child link="Component_1"/>');
  expect(out.text).toMatch(/<mesh filename="package:\/\/\w+\/meshes\/Component_1\.stl"\/>/);
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
    ["Box 2", "Component 1"],
    ["Box 1", "Component 2"],
  ] as const) {
    await page.getByRole("treeitem", { name: new RegExp(`^${box}`) }).click({ button: "right" });
    await page.getByRole("menuitem", { name: /New component/ }).click();
    await expect(page.getByText(`Made ${link} of 1 body`)).toBeVisible();
  }
  for (const [x, link, joint] of [
    [25, "Component 1", "Joint 1"],
    [0, "Component 2", "Joint 2"],
  ] as const) {
    await hingeOnBase(page, link, x);
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
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await expect(page.getByText("Made Component 1 of 1 body")).toBeVisible();
  await hingeOnBase(page, "Component 1", 25);
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
  await expect(page.getByText("Set the tool point on Component 1. Drag Component 1 to move the arm.")).toBeVisible();

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

type ClashView = {
  __bcView: { bodies: Map<string, { body: { clash?: boolean; ghost?: boolean } }>; clashBoxes: { children: { name: string }[] } };
};
/** How many bodies the view draws red and ghosted, and how many overlaps it fills in. */
const clashLook = (page: Page) =>
  page.evaluate(() => {
    const v = (window as unknown as ClashView).__bcView;
    const bodies = [...v.bodies.values()].map((o) => o.body);
    return {
      clash: bodies.filter((b) => b.clash).length,
      ghost: bodies.filter((b) => b.ghost).length,
      overlaps: v.clashBoxes.children.filter((c) => c.name === "clash").length,
    };
  });

test("check for clashes: an overlap, then a touch", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  // Two 20 mm boxes 10 mm apart overlap by 10 × 20 × 20 mm; Box 3 sits well clear.
  const x = page.getByRole("textbox", { name: "X (mm)" });
  await page.getByRole("treeitem", { name: /^Box 3/ }).click();
  await x.fill("60");
  await x.press("Enter");
  await page.getByRole("treeitem", { name: /^Box 2/ }).click();
  await x.fill("10");
  await x.press("Enter");
  await page.keyboard.press("ControlOrMeta+k");
  // The palette focuses its field a tick after it opens; letters typed before then would run shortcuts.
  const command = page.getByRole("combobox", { name: "Command" });
  await expect(command).toBeFocused();
  await command.fill("Check for clashes");
  await page.getByRole("option", { name: /Check for clashes/ }).click();
  const props = page.getByRole("complementary", { name: "Properties" });
  await expect(props.getByRole("button", { name: "Check clashes", pressed: true })).toBeVisible();
  await expect(props.getByRole("list", { name: "Overlaps" })).toHaveText(/Box 1 and Box 2 overlap by 4 cm³/, { timeout: 30_000 });
  await props.getByRole("button", { name: "Show" }).click();
  // The two that clash are drawn red, the overlap itself is filled in and Box 3 is ghosted; Esc puts the view back.
  await expect.poll(() => clashLook(page)).toEqual({ clash: 2, ghost: 1, overlaps: 1 });
  await page.keyboard.press("Escape");
  await expect(props.getByRole("button", { name: "Check clashes", pressed: false })).toBeVisible();
  await expect.poll(() => clashLook(page)).toEqual({ clash: 0, ghost: 0, overlaps: 0 });
  await props.getByRole("button", { name: "Check clashes" }).click();
  await expect(props.getByRole("list", { name: "Overlaps" })).toBeVisible({ timeout: 30_000 });

  // Side by side, they only touch; apart, nothing clashes.
  await page.getByRole("treeitem", { name: /^Box 2/ }).click();
  await x.fill("20");
  await x.press("Enter");
  await page.keyboard.press("Escape");
  await expect(props.getByRole("list", { name: "Touching" })).toHaveText(/Box 1 and Box 2 touch/, { timeout: 30_000 });
  await expect(props.getByRole("list", { name: "Overlaps" })).toHaveCount(0);
});

test("save a named pose and go back to it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await hingeOnBase(page, "Component 1", 25);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();

  const angle = page.getByRole("complementary", { name: "Properties" }).getByRole("textbox", { name: /^Angle/ });
  await angle.fill("40");
  await angle.press("Enter");
  await expect(angle).toHaveValue("40");

  // Save it from the palette and name it as it lands in the browser.
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Save pose");
  await page.getByRole("option", { name: /Save pose/ }).click();
  await expect(page.getByText("Saved Pose 1. Type a name, or press Enter to keep it.")).toBeVisible();
  await page.keyboard.type("Reach");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Reach/ })).toContainText("Now");

  // Home, then back to Reach from the browser.
  await page.getByRole("tree", { name: "Browser" }).getByText("Home", { exact: true }).click();
  await expect(page.getByText("Went to Home")).toBeVisible();
  await expect(angle).toHaveValue("0");
  await page.getByRole("tree", { name: "Browser" }).getByText("Reach", { exact: true }).click();
  await expect(page.getByText("Went to Reach")).toBeVisible();
  await expect(angle).toHaveValue("40");
  await expect(page.getByRole("button", { name: /^Undo go to reach/i })).toBeVisible();
});

test("sweep a joint for clashes and set the limit it suggests", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".bc-view-engine")).toHaveCount(0, { timeout: 60_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Library" }).click();
    await page.getByRole("button", { name: "Box", exact: true }).click();
  }
  // Box 2 sits 2 mm clear of Box 1 and turns about its own middle: past about 13° either way its corners hit Box 1.
  await page.getByRole("treeitem", { name: /^Box 2/ }).click();
  const x = page.getByRole("textbox", { name: "X (mm)" });
  await x.fill("22");
  await x.press("Enter");
  await page.getByRole("treeitem", { name: /^Box 2/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /New component/ }).click();
  await hingeOnBase(page, "Component 1", 22);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem", { name: /^Joint 1/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  const command = page.getByRole("combobox", { name: "Command" });
  await expect(command).toBeFocused();
  await command.fill("Sweep the joints");
  await page.getByRole("option", { name: /Sweep the joints for clashes/ }).click();
  const props = page.getByRole("complementary", { name: "Properties" });
  const hits = props.getByRole("list", { name: "Hits" });
  await expect(hits).toContainText(/Box 2 hits Box 1 from 1[23](\.\d)?° to 7[67](\.\d)?° on Joint 1/, { timeout: 30_000 });
  await expect(hits.getByRole("listitem")).toHaveCount(2);

  // Show poses the arm at the first clash; the suggested limits keep it clear.
  await hits.getByRole("button", { name: "Show" }).first().click();
  await expect(page.getByRole("button", { name: /^Undo show the clash/i })).toBeVisible();
  await props.getByRole("button", { name: /^Set the limits to -1[23]° and 1[23]°$/ }).click();
  await expect(hits).toHaveCount(0);
  await props.getByRole("button", { name: "Sweep", exact: true }).click();
  await expect(props.getByRole("status").filter({ hasText: "Nothing hits from end to end." })).toBeVisible({ timeout: 30_000 });
});
