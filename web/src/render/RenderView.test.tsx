import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { barPosition, filmingText, RenderBar, RenderRibbon, SLOW_TEXT, SLUGGISH_TEXT } from "./RenderView";
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
    await userEvent.click(await within(bar).findByRole("button", { name: "Play" }));
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
    for (const name of ["Lightbox", "Grey table", "Workbench", "Holoroom", "Replicator", "Black", "Transparent"])
      expect(screen.getByRole("menuitemradio", { name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Holoroom" }));
    expect(s.get().background).toBe("holoroom");
    expect(s.get().preset).toBe("studio");
    await userEvent.click(screen.getByRole("button", { name: "Holoroom" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Transparent" }));
    expect(s.get().background).toBe("transparent");
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
    s.set({ playMode: "preview" });
    s.set({ loading: false, samples: 1, stopped: false });
    render(<RenderRibbon session={s} />);
    expect(screen.queryByRole("button", { name: /^Save video/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Draw on/ }));
    expect(s.get().drawOn).toMatchObject({ colour: "blue", length: "normal", playing: true });
    expect(s.get().stopped).toBe(true);
    // Play plays Draw on in Video preview.
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
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

describe("camera moves in the Render view", () => {
  it("picks a move from the ribbon's Animate group, plays it on its own, and shares Draw on's length", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    const s = renderSession();
    s.set({ playMode: "preview" });
    s.set({ loading: false, samples: 1 });
    render(<RenderRibbon session={s} />);
    expect(screen.queryByRole("button", { name: /^Save video/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Camera move: none" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Speed ramp orbit" }));
    expect(s.get().move).toMatchObject({ id: "ramp", length: "normal", playing: true, total: 10 });
    expect(screen.getByRole("button", { name: /^Save video/ })).toBeEnabled();
    // No colour for a move on its own: that is Draw on's.
    expect(screen.queryByRole("button", { name: /^Colour:/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(s.get().move?.playing).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Length: Normal, 10 s" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Quick, 5 s" }));
    expect(s.get().move).toMatchObject({ length: "quick", playing: true });
    // Played to the end: play again from the start, and record with Save video.
    const replayMove = vi.fn();
    const recordMove = vi.fn(async () => {});
    s.replayMove = replayMove;
    s.recordMove = recordMove;
    s.set({ move: { ...s.get().move!, playing: false, at: 5, total: 5 } });
    await userEvent.click(await screen.findByRole("button", { name: "Play again" }));
    expect(replayMove).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^Save video/ }));
    expect(recordMove).toHaveBeenCalled();
    // Draw on takes the move's length, and its clock: the move goes with the drawing.
    await userEvent.click(screen.getByRole("button", { name: /^Draw on/ }));
    expect(s.get().drawOn).toMatchObject({ length: "quick" });
    expect(s.get().move?.id).toBe("ramp");
    await userEvent.click(screen.getByRole("button", { name: "Camera move: Speed ramp orbit" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "No camera move" }));
    expect(s.get().move).toBeNull();
    vi.unstubAllGlobals();
  });

  it("shows where a move on its own has got", async () => {
    const s = renderSession();
    s.set({ loading: false, move: { id: "orbit", length: "normal", playing: true, at: 2.5, total: 10, recording: false } });
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Orbit, 2.5 s of 10 s");
    expect(screen.getByRole("button", { name: "Camera move: Orbit" })).toBeInTheDocument();
    s.set({ move: { ...s.get().move!, recording: true } });
    expect(await screen.findByText("Recording the video, 2.5 s of 10 s")).toBeInTheDocument();
  });
});

describe("the one Play button", () => {
  it("picks Image, Video preview or Video render from its drop-down, and runs it", async () => {
    vi.stubGlobal("VideoEncoder", class {});
    vi.stubGlobal("VideoFrame", class {});
    const s = renderSession();
    s.set({ loading: false, samples: 1 });
    render(<RenderRibbon session={s} />);
    const modes = () => userEvent.click(screen.getByRole("button", { name: /^Play: / }));
    expect(screen.getByRole("button", { name: "Play: Image" })).toBeInTheDocument();
    await modes();
    expect(screen.getAllByRole("menuitemradio").map((e) => e.textContent)).toEqual(["Image", "Video preview", "Video render"]);
    // Video preview with nothing to animate plays an orbit.
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Video preview" }));
    expect(s.get()).toMatchObject({ playMode: "preview", move: { id: "orbit", playing: true } });
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(s.get().move?.playing).toBe(false);
    // Video render path-traces the move's frames.
    const renderVideo = vi.fn(async () => {});
    s.renderVideo = renderVideo;
    await modes();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Video render" }));
    expect(renderVideo).toHaveBeenCalled();
    s.set({ filming: { name: "Orbit video", frame: 12, frames: 300, sample: 4, samples: 16, started: 0, canvas: null } });
    const stopVideo = vi.fn();
    s.stopVideo = stopVideo;
    await userEvent.click(await screen.findByRole("button", { name: "Stop the video render" }));
    expect(stopVideo).toHaveBeenCalled();
    s.set({ filming: null });
    // Image puts the animation away and renders the picture.
    s.set({ drawOn: { colour: "blue", length: "normal", playing: true, at: 1, total: 12, recording: false } });
    await modes();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Image" }));
    expect(s.get()).toMatchObject({ playMode: "image", drawOn: null, stopped: false });
    vi.unstubAllGlobals();
  });

  it("says how far a video render has got, with bars for this frame and the whole video", () => {
    const s = renderSession();
    s.set({ loading: false, filming: { name: "Orbit video", frame: 12, frames: 300, sample: 4, samples: 16, started: 0, canvas: null } });
    render(<RenderBar session={s} onClose={() => {}} onExportGltf={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Rendering the video, frame 13 of 300");
    expect(screen.getByRole("progressbar", { name: "This frame" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByRole("progressbar", { name: "This frame" })).toHaveAttribute("aria-valuetext", "4 of 16 samples");
    expect(screen.getByRole("progressbar", { name: "Whole video" })).toHaveAttribute("aria-valuenow", "4");
    // The samples come in: the frame's bar fills.
    act(() => s.set({ filming: { ...s.get().filming!, sample: 12 } }));
    expect(screen.getByRole("progressbar", { name: "This frame" })).toHaveAttribute("aria-valuenow", "75");
    act(() => s.set({ filming: null }));
    expect(screen.queryByRole("progressbar", { name: "This frame" })).not.toBeInTheDocument();
  });

  it("says how long a video render has left", () => {
    const f = { name: "Orbit video", frame: 30, frames: 300, sample: 0, samples: 16, started: 0, canvas: null };
    // 30 frames in a minute: 270 to go take about 9 minutes.
    expect(filmingText(f, 60_000)).toBe("Rendering the video, frame 31 of 300, about 9 min left");
    expect(filmingText({ ...f, frame: 0 }, 60_000)).toBe("Rendering the video, frame 1 of 300");
    expect(filmingText({ ...f, frame: 299 }, 60_000)).toBe("Rendering the video, frame 300 of 300, under a minute left");
  });
});
