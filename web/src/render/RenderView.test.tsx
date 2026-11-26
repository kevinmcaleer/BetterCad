import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { barPosition, RenderBar, RenderRibbon, SLOW_TEXT, SLUGGISH_TEXT } from "./RenderView";
import { renderSession } from "./session";

describe("the Render view's options (#197)", () => {
  it("says it is loading, then counts samples, and changes the lighting", async () => {
    const s = renderSession();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the renderer…");
    s.set({ loading: false, stopped: false, samples: 24 });
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

  it("opens stopped, then starts and stops the picture with a round button, so background renders get the GPU", async () => {
    const s = renderSession();
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    // A first look only: nothing renders until you press Start.
    s.set({ loading: false, samples: 1 });
    expect(await screen.findByText("Press Start to render")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start rendering" }));
    expect(s.get().stopped).toBe(false);
    s.set({ samples: 40 });
    await userEvent.click(await screen.findByRole("button", { name: "Stop rendering" }));
    expect(s.get().stopped).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Stopped at 40 of 512 samples");
    await userEvent.click(screen.getByRole("button", { name: "Start rendering" }));
    expect(s.get().stopped).toBe(false);
    // Finished: nothing left to start until the quality goes up.
    s.set({ samples: 512 });
    expect(await screen.findByRole("button", { name: "Finished: raise the quality to keep going" })).toBeDisabled();
  });

  it("keeps the options on the ribbon's Render tab, only the status on the bar, and no Done", async () => {
    const s = renderSession();
    const onAdd = vi.fn();
    render(
      <>
        <RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} ribbon />
        <div role="toolbar" aria-label="Render tools">
          <RenderRibbon session={s} onAdd={onAdd} />
        </div>
      </>,
    );
    const bar = screen.getByRole("group", { name: "Render options" });
    expect(bar).toHaveTextContent("Loading the renderer…");
    expect(bar.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Done/ })).toBeNull();
    s.set({ loading: false, samples: 1 });
    await userEvent.click(await screen.findByRole("button", { name: "Lighting: Studio" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Daylight" }));
    expect(s.get().preset).toBe("daylight");
    await userEvent.click(screen.getByRole("button", { name: "Background: Lightbox" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Holoroom" }));
    expect(s.get().background).toBe("holoroom");
    await userEvent.click(screen.getByRole("button", { name: /^Paper/ }));
    expect(s.get().style).toBe("paper");
    expect(bar).toHaveTextContent("Press Start to render");
    await userEvent.click(screen.getByRole("button", { name: "Start rendering" }));
    expect(s.get().stopped).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Stop rendering" }));
    expect(s.get().stopped).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /^Add to strip/ }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("starts and stops from the bar's Start beside the status, in step with the ribbon", async () => {
    const s = renderSession();
    render(
      <>
        <RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} ribbon />
        <div role="toolbar" aria-label="Render tools">
          <RenderRibbon session={s} />
        </div>
      </>,
    );
    s.set({ loading: false, samples: 1 });
    const bar = screen.getByRole("group", { name: "Render options" });
    await userEvent.click(await within(bar).findByRole("button", { name: "Start" }));
    expect(s.get().stopped).toBe(false);
    expect(screen.getByRole("button", { name: "Stop rendering" })).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Stop" }));
    expect(s.get().stopped).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Start rendering" }));
    expect(within(bar).getByRole("button", { name: "Stop" })).toBeInTheDocument();
    // Finished: the bar has nothing to start, the ribbon says why.
    s.set({ samples: 512 });
    await waitFor(() => expect(within(bar).queryByRole("button")).toBeNull());
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

describe("Draw on in the Render view", () => {
  it("turns on from the ribbon, stops the picture, and picks length and colour", async () => {
    const s = renderSession();
    s.set({ loading: false, samples: 1, stopped: false });
    render(<RenderRibbon session={s} />);
    expect(screen.queryByRole("button", { name: /^Save video/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Draw on/ }));
    expect(s.get().drawOn).toMatchObject({ colour: "blue", length: "normal", playing: true });
    expect(s.get().stopped).toBe(true);
    // The path tracer waits while Draw on shows.
    expect(screen.getByRole("button", { name: "Start rendering" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Length: Normal, 10 s" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Slow, 20 s" }));
    expect(s.get().drawOn?.length).toBe("slow");
    await userEvent.click(screen.getByRole("button", { name: "Colour: Neon blue" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Each part's colour" }));
    expect(s.get().drawOn?.colour).toBe("parts");
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(s.get().drawOn?.playing).toBe(false);
    // Played to the end: play again from the start.
    const replay = vi.fn();
    s.replay = replay;
    s.set({ drawOn: { ...s.get().drawOn!, at: 12, total: 12 } });
    await userEvent.click(await screen.findByRole("button", { name: "Play again" }));
    expect(replay).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^Draw on/ }));
    expect(s.get().drawOn).toBeNull();
  });

  it("shows where the animation has got, and when it is recording", async () => {
    const s = renderSession();
    s.set({ loading: false, drawOn: { colour: "blue", length: "normal", playing: true, at: 3.24, total: 12.8, recording: false } });
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Draw on, 3.2 s of 12.8 s");
    s.set({ drawOn: { ...s.get().drawOn!, recording: true } });
    expect(await screen.findByText("Recording the video, 3.2 s of 12.8 s")).toBeInTheDocument();
  });
});
