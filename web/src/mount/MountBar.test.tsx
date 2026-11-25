import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MOUNT_DEFAULTS, type MountFeature } from "../state/document";
import { MountBar } from "./MountBar";
import type { MountSession } from "./useMount";

const feature = (more: Partial<MountFeature> = {}): MountFeature => ({
  ...MOUNT_DEFAULTS,
  id: "m1",
  type: "mount",
  name: "Standoffs 1",
  kind: "standoffs",
  part: "b1",
  frame: { origin: [0, 0, 2], x: [1, 0, 0], normal: [0, 0, 1] },
  points: [[0, 0]],
  ...more,
});
const board = {
  points: [
    [-26, -16],
    [16, 16],
  ] as [number, number][],
  height: 6,
  drill: 3.2,
};
const session = (f: MountFeature, b: typeof board | null, change = vi.fn()) =>
  ({ session: { id: "m1", isNew: true }, feature: f, change, done: vi.fn(), cancel: vi.fn(), edit: vi.fn(), help: null, board: b }) as unknown as MountSession;

/** Standoffs under the board (#652), from the Mount tool's Pattern menu. */
describe("the Mount bar with a board over the face", () => {
  it("puts standoffs under the board's holes in one pick, with the screw that fits them", async () => {
    const change = vi.fn();
    render(<MountBar x={session(feature(), board, change)} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Pattern" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Under the board's holes" }));
    expect(change).toHaveBeenCalledWith({ underBoard: true, points: board.points, height: 6, size: "M3" });
  });

  it("says they follow the board, and takes the height and places from it", () => {
    render(<MountBar x={session(feature({ underBoard: true }), board)} onCancel={() => {}} />);
    expect(screen.getByText("2 standoffs under the board's mounting holes, 6 mm tall. They follow the board.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Height/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Standoff.* X/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Width/)).toBeInTheDocument();
  });

  it("goes back to your own layout when another pattern is picked", async () => {
    const change = vi.fn();
    render(<MountBar x={session(feature({ underBoard: true }), board, change)} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Pattern" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "One standoff" }));
    expect(change.mock.calls[0]![0]).toMatchObject({ points: [[0, 0]] });
    expect("underBoard" in change.mock.calls[0]![0] && change.mock.calls[0]![0].underBoard).toBeUndefined();
  });

  it("offers nothing from the board when there is none over the face, and says so for a step that followed one", () => {
    const { unmount } = render(<MountBar x={session(feature(), null)} onCancel={() => {}} />);
    expect(screen.getByText(/^1 standoff\./)).toBeInTheDocument();
    unmount();
    render(<MountBar x={session(feature({ underBoard: true }), null)} onCancel={() => {}} />);
    expect(screen.getByText("The board is not over this face now, so the standoffs stay where they were.")).toBeInTheDocument();
  });
});
