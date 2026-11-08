import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RenderBar, SLOW_TEXT } from "./RenderView";
import { renderSession } from "./session";

describe("the Render view's options (#197)", () => {
  it("says it is loading, then counts samples, and changes the lighting", async () => {
    const s = renderSession();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the renderer…");
    s.set({ loading: false, samples: 24 });
    expect(await screen.findByText("24 samples")).toBeInTheDocument();
    s.set({ moving: true });
    expect(await screen.findByText("Waiting for you to stop moving")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Studio" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Daylight" }));
    expect(s.get().preset).toBe("daylight");
    expect(screen.getByRole("button", { name: "Daylight" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Paper" }));
    expect(s.get().style).toBe("paper");
  });

  it("offers glTF for Blender when the browser can't render well", async () => {
    const s = renderSession();
    const onExportGltf = vi.fn();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={onExportGltf} />);
    expect(screen.queryByText(SLOW_TEXT)).toBeNull();
    s.set({ loading: false, slow: true });
    expect(await screen.findByText(SLOW_TEXT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Export glTF" }));
    expect(onExportGltf).toHaveBeenCalled();
  });

  it("saves at view size, twice the size or 4K, and Done goes back", async () => {
    const s = renderSession();
    const save = vi.fn(async () => {});
    s.save = save;
    s.set({ loading: false });
    const onClose = vi.fn();
    render(<RenderBar session={s} onClose={onClose} onExportGltf={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Save image" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "3840 × 2160" }));
    expect(save).toHaveBeenCalledWith("4k");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
