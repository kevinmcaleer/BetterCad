import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { newDoc } from "../state/document";
import type { Kevsrobots } from "./kevsrobots";
import { SendDialog } from "./SendDialog";

vi.mock("./exportSteps", () => ({
  exportSteps: vi.fn(async () => ({ name: "Bracket build steps.zip", bytes: new Uint8Array([1]), steps: 4 })),
}));

const fakeClient = (): Kevsrobots & { [k: string]: ReturnType<typeof vi.fn> } => ({
  projects: vi.fn(async () => [{ id: 7, title: "Rover build", status: "draft", cover_image: null }]),
  create: vi.fn(async (title: string) => ({ id: 8, title, status: "draft", cover_image: null })),
  send: vi.fn(async (project: number) => ({ id: 1, project_id: project, title: "Bracket", steps: 4, pictures: 5, files: 2, is_update: project === 7 })),
});

const setup = (over: Partial<Parameters<typeof SendDialog>[0]> = {}) => {
  const client = fakeClient();
  const p = {
    doc: { ...newDoc(), name: "Bracket" },
    upTo: 0,
    call: vi.fn(() => null),
    signedIn: true,
    onLinked: vi.fn(),
    onClose: vi.fn(),
    say: vi.fn(),
    client,
    ...over,
  };
  render(<SendDialog {...p} />);
  return { p, client };
};

describe("SendDialog", () => {
  it("asks you to sign in first", () => {
    setup({ signedIn: false, signinUrl: "#/signin" });
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("makes a new project, sends the steps and links the model", async () => {
    const { p, client } = setup();
    await waitFor(() => expect(screen.getByRole("option", { name: "Rover build" })).toBeTruthy());
    const name = screen.getByLabelText("Project name");
    fireEvent.change(name, { target: { value: "Arm" } });
    expect(screen.getByText("Use at least 5 characters.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(name, { target: { value: "Bracket build" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open the project" })).toBeTruthy());
    expect(client.create).toHaveBeenCalledWith("Bracket build");
    expect(client.send).toHaveBeenCalledWith(8, "Bracket build steps.zip", expect.any(Uint8Array), undefined);
    expect(p.onLinked).toHaveBeenCalledWith(expect.objectContaining({ project: 8, title: "Bracket build" }));
    expect(screen.getByRole("link", { name: "Open the project" }).getAttribute("href")).toBe("https://www.kevsrobots.com/projects/editor.html?id=8");
  });

  it("offers an update to the project it was sent to before", async () => {
    const { client } = setup({ doc: { ...newDoc(), name: "Bracket", kevsrobots: { project: 7, title: "Rover build", sent: "2026-11-10T09:00:00Z" } } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Rover build (sent before)" })).toBeTruthy());
    expect(screen.getByRole("dialog", { name: "Update on kevsrobots" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/update is waiting in Rover build/));
    expect(client.create).not.toHaveBeenCalled();
  });
});
