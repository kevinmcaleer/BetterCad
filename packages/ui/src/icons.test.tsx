import { render } from "@testing-library/react";
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
