import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "./Editor";

/** Settings and Print settings both open from the account menu. */
function openSettings(name = "Settings") {
  fireEvent.click(screen.getByRole("button", { name: /account and settings/i }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

describe("Build volume toggle", () => {
  beforeEach(() => localStorage.clear());
  it("hides the build volume from Settings and Print alike", async () => {
    render(<Editor />);
    openSettings();
    const inSettings = screen.getByRole("checkbox", { name: "Show the build volume" });
    expect(inSettings).toBeChecked();
    fireEvent.click(inSettings);
    expect(localStorage.getItem("bettercad.showBed")).toBe("0");

    openSettings("Print settings");
    // The Print panel loads when it first opens.
    const inPrint = await screen.findByRole("checkbox", { name: "Show the build volume" });
    expect(inPrint).not.toBeChecked();
    fireEvent.click(inPrint);
    openSettings();
    expect(screen.getByRole("checkbox", { name: "Show the build volume" })).toBeChecked();
  });

  it("toggles the build volume from the view cube's menu", () => {
    render(<Editor />);
    const options = () => fireEvent.click(screen.getByRole("button", { name: "View cube options" }));
    options();
    const item = screen.getByRole("menuitemcheckbox", { name: "Show build volume" });
    expect(item).toHaveAttribute("aria-checked", "true");
    fireEvent.click(item);
    expect(localStorage.getItem("bettercad.showBed")).toBe("0");
    options();
    expect(screen.getByRole("menuitemcheckbox", { name: "Show build volume" })).toHaveAttribute("aria-checked", "false");
  });
});
