import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UploadCard } from "./UploadCard";

describe("the upload card", () => {
  it("shows each file's stage and bar while it goes up, with no close button", () => {
    render(
      <UploadCard
        rows={[
          { file: "STS3215 Servo.step", state: "working", stage: "Finding the solids", fraction: 0.5 },
          { file: "Horn.stl", state: "waiting", stage: "Waiting" },
        ]}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 of 2 files");
    expect(screen.getByText("Finding the solids")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Uploading STS3215 Servo.step" })).toHaveAttribute("value", "0.5");
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("says why a file failed and stays until it's closed", () => {
    const close = vi.fn();
    render(
      <UploadCard
        rows={[
          { file: "Servo.step", state: "failed", stage: "That STEP file is damaged." },
          { file: "Horn.stl", state: "done", stage: "Horn" },
        ]}
        onClose={close}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 uploads failed");
    expect(screen.getByRole("alert")).toHaveTextContent("That STEP file is damaged.");
    expect(screen.getByText("Saved as Horn")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(2);
  });
});
