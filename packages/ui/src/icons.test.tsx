import { render, waitFor } from "@testing-library/react";
import { ICONS, type IconName } from "./icons";
import { Icon } from "./Icon";

describe("icons", () => {
  it("renders every icon on a 24-unit grid", () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.querySelector("path")!.getAttribute("d")).toBeTruthy();
      unmount();
    }
  });
  it("includes the BetterCad modelling icons", () => {
    for (const n of ["sketch", "extrude", "pushpull", "combine", "fillet", "dimension", "constraint", "hole"]) expect(ICONS).toHaveProperty(n);
  });
  it("labels an icon when given a title", () => {
    const { getByRole } = render(<Icon name="save" title="Saved" />);
    expect(getByRole("img", { name: "Saved" })).toBeInTheDocument();
  });
});

describe("colour icons", () => {
  it("draws the colour icon once the set has loaded, and the line icon until then", async () => {
    const { container } = render(<Icon name="extrude" colour />);
    await waitFor(() => expect(container.querySelector(".bc-icon-colour")).not.toBeNull());
    expect(container.querySelector("path[d]")).not.toBe(container.querySelector(`path[d="${ICONS.extrude}"]`));
  });
  it("keeps the line icon for a name without a colour drawing", async () => {
    const { container } = render(<Icon name="save" colour />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".bc-icon-colour")).toBeNull();
  });
  it("draws every colour icon with tokens only", async () => {
    const { colourIcons } = await import("./colourIcons");
    const all = colourIcons();
    expect(Object.keys(all).length).toBeGreaterThan(40);
    for (const [name, svg] of Object.entries(all)) {
      expect(svg, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      expect(svg, name).toContain("var(--bc-color-icon-");
    }
  });
});
