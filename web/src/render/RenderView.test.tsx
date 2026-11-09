import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { barPosition, RenderBar, SLOW_TEXT, SLUGGISH_TEXT } from "./RenderView";
import { renderSession } from "./session";

describe("the Render view's options (#197)", () => {
  it("says it is loading, then counts samples, and changes the lighting", async () => {
    const s = renderSession();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the renderer…");
    s.set({ loading: false, samples: 24 });
    expect(await screen.findByText("24 of 512 samples")).toBeInTheDocument();
    s.set({ moving: true });
    expect(await screen.findByText("Waiting for you to stop moving")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Studio" }));
    expect(screen.getByRole("menuitemradio", { name: "Lightbox" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Daylight" }));
    expect(s.get().preset).toBe("daylight");
    expect(screen.getByRole("button", { name: "Daylight" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Paper" }));
    expect(s.get().style).toBe("paper");
  });

  it("picks a background apart from the lighting", async () => {
    const s = renderSession();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    s.set({ loading: false });
    await userEvent.click(await screen.findByRole("button", { name: "Lightbox" }));
    for (const name of ["Lightbox", "Grey table", "Workbench", "Holoroom", "Replicator"])
      expect(screen.getByRole("menuitemradio", { name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Holoroom" }));
    expect(s.get().background).toBe("holoroom");
    expect(s.get().preset).toBe("studio");
  });

  it("sets the quality with a Good, Better, Best slider", async () => {
    const s = renderSession();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    s.set({ loading: false, samples: 3 });
    const slider = await screen.findByRole("slider", { name: "Quality" });
    expect(slider).toHaveAttribute("aria-valuetext", "Better, 512 samples");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(s.get().quality).toBe("best");
    expect(screen.getByRole("status")).toHaveTextContent("3 of 2,048 samples");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(s.get().quality).toBe("good");
    expect(slider).toHaveAttribute("aria-valuetext", "Good, 128 samples");
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

  it("notes a slow render in a toast, without the warning banner", async () => {
    const s = renderSession();
    const onNote = vi.fn();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} onNote={onNote} />);
    s.set({ loading: false, sluggish: true });
    await waitFor(() => expect(onNote).toHaveBeenCalledWith(SLUGGISH_TEXT));
    expect(screen.queryByText(SLOW_TEXT)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save image" }));
    expect(screen.getByRole("menuitem", { name: "View size" })).toBeEnabled();
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

  it("sets the depth of field", async () => {
    const s = renderSession();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    s.set({ loading: false });
    await userEvent.click(await screen.findByRole("button", { name: "Soft focus" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "All sharp" }));
    expect(s.get().focus).toBe("sharp");
  });

  it("fills the quality bar evenly between the Good, Better and Best stops", () => {
    expect(barPosition(0)).toBe(0);
    expect(barPosition(64)).toBeCloseTo(1 / 6);
    expect(barPosition(128)).toBeCloseTo(1 / 3);
    expect(barPosition(320)).toBeCloseTo(1 / 2);
    expect(barPosition(512)).toBeCloseTo(2 / 3);
    expect(barPosition(2048)).toBe(1);
    expect(barPosition(5000)).toBe(1);
  });
});
