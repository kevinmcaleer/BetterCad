import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "./Editor";

function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: /account and settings/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
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

    fireEvent.click(screen.getByRole("button", { name: /^Print/ }));
    // The Print panel loads when it first opens.
    const inPrint = await screen.findByRole("checkbox", { name: "Show the build volume" });
    expect(inPrint).not.toBeChecked();
    fireEvent.click(inPrint);
    openSettings();
    expect(screen.getByRole("checkbox", { name: "Show the build volume" })).toBeChecked();
  });
});
