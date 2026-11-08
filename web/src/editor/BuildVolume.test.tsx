import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "./Editor";

describe("Build volume toggle", () => {
  beforeEach(() => localStorage.clear());
  it("hides the build volume from Settings and Print alike", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    const inSettings = screen.getByRole("checkbox", { name: "Show the build volume" });
    expect(inSettings).toBeChecked();
    fireEvent.click(inSettings);
    expect(localStorage.getItem("bettercad.showBed")).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: /^Print/ }));
    const inPrint = screen.getByRole("checkbox", { name: "Show the build volume" });
    expect(inPrint).not.toBeChecked();
    fireEvent.click(inPrint);
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(screen.getByRole("checkbox", { name: "Show the build volume" })).toBeChecked();
  });
});
