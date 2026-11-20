import { fireEvent, render } from "@testing-library/react";
import { SuiteSwitcher } from "./SuiteSwitcher";
import "../vendor/kr-suite.js";

// The switcher draws itself in a shadow root, so these look inside it.
function shadowOf() {
  const { container } = render(<SuiteSwitcher />);
  const host = container.querySelector("kr-app-switcher") as HTMLElement & { open: boolean };
  return { host, root: host.shadowRoot! };
}

describe("the kevsrobots app switcher", () => {
  it("lists the four apps and marks BetterCAD as where you are", () => {
    const { root } = shadowOf();
    const links = [...root.querySelectorAll("a")];
    expect(links.map((a) => a.querySelector("b")!.textContent!.split(" ")[0])).toEqual(["Learn", "Projects", "Snakie", "BetterCAD"]);
    const here = links.filter((a) => a.getAttribute("aria-current"));
    expect(here).toHaveLength(1);
    expect(here[0]!.dataset.app).toBe("bettercad");
  });

  it("opens the other apps in a new tab, so the model stays put", () => {
    const { root } = shadowOf();
    for (const a of root.querySelectorAll("a:not([aria-current])")) expect(a.getAttribute("target")).toBe("_blank");
  });

  it("opens from its button and closes with Esc", () => {
    const { host, root } = shadowOf();
    const button = root.querySelector("button")!;
    expect(button).toHaveAttribute("aria-label", "Switch kevsrobots app");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(root.querySelector("nav")!, { key: "Escape" });
    expect(host.open).toBe(false);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
