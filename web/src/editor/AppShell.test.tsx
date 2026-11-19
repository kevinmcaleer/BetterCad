import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

const slots = {
  topBar: <header aria-label="Top bar">Tools</header>,
  leftPanel: <p>Browser</p>,
  leftLabel: "Browser",
  picker: <aside aria-label="My models">Models</aside>,
  stageToolbar: <div>View bar</div>,
  stage: <div id="bc-view">The model</div>,
  timeline: <nav aria-label="Timeline">Steps</nav>,
  helpLine: <span>Drag to look around</span>,
  rightPanel: <aside aria-label="Properties">Props</aside>,
};

describe("AppShell", () => {
  it("shows the top bar, panels and timeline around the view", () => {
    render(<AppShell {...slots} />);
    expect(screen.getByLabelText("Top bar")).toBeInTheDocument();
    expect(screen.getByLabelText("Browser")).toBeInTheDocument();
    expect(screen.getByLabelText("My models")).toBeInTheDocument();
    expect(screen.getByLabelText("Timeline")).toBeInTheDocument();
    expect(screen.getByLabelText("Properties")).toBeInTheDocument();
  });

  it("in frame mode shows only its bar, the view and the view tools (#508)", () => {
    render(<AppShell {...slots} frame={<header aria-label="Shared model">Phone stand by Kev</header>} />);
    expect(screen.getByLabelText("Shared model")).toBeInTheDocument();
    expect(screen.getByText("The model")).toBeInTheDocument();
    expect(screen.getByText("View bar")).toBeInTheDocument();
    expect(screen.getByText("Drag to look around")).toBeInTheDocument();
    expect(screen.queryByLabelText("Top bar")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Browser")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("My models")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Timeline")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Properties")).not.toBeInTheDocument();
  });
});
