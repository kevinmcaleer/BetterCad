import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CameraState } from "../viewport/camera";
import { cameraAt, cameraMove, framingOf, type Framing } from "./cameraMoves";
import { DrawOnView, videoType } from "./drawOnView";
import type { RenderBody } from "./pathRender";
import { drawSeconds, type RenderSession } from "./session";

/** Embers drawing at once. */
const EMBERS = 3;

export interface DrawOnPictureProps {
  session: RenderSession;
  bodies: RenderBody[];
  /** Where the render's camera is now: orbiting the picture moves it, and Draw on follows. */
  camera: () => CameraState;
  /** Saves the video. Called at once on the click, with the video still recording, so it can ask where to save. */
  onSaveVideo?: (video: Promise<Blob | null>, ext: "mp4" | "webm") => Promise<void>;
}

/**
 * Draw on, over the Render view's picture: embers trace the model's edges in neon, faces show as ghosts once their
 * edges are drawn, and the model firms up to solid by the end. Pointer moves pass through to the picture underneath,
 * which turns the shared camera.
 */
export default function DrawOnPicture({ session, bodies, camera, onSaveVideo }: DrawOnPictureProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<DrawOnView | null>(null);
  const cam = useRef(camera);
  cam.current = camera;
  /** The model's middle and size, for a camera move. */
  const framing = useRef<Framing | null>(null);
  const state = useSyncExternalStore(session.subscribe, session.get).drawOn;
  const colour = state?.colour ?? "blue";
  const length = state?.length ?? "normal";

  useEffect(() => {
    const el = canvas.current!;
    let v: DrawOnView;
    const patch = (change: Partial<NonNullable<ReturnType<RenderSession["get"]>["drawOn"]>>) => {
      const d = session.get().drawOn;
      if (d) session.set({ drawOn: { ...d, ...change } });
    };
    try {
      v = new DrawOnView(el, {
        // With a camera move on, the move turns the camera through the whole of Draw on, from where you were looking.
        camera: () => {
          const m = session.get().move;
          const f = framing.current;
          const view = cam.current();
          if (!m || !f || !v?.total) return view;
          return cameraAt(cameraMove(m.id, v.total), view, { ...f, aspect: el.clientWidth / Math.max(1, el.clientHeight) }, v.at);
        },
        onTime: (at, total) => patch({ at, total }),
        onEnd: () => patch({ playing: false, at: v.total, total: v.total }),
      });
    } catch {
      session.set({ drawOn: null, slow: true });
      return;
    }
    view.current = v;
    const fit = () => v.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    session.replay = () => {
      v.play(0);
      patch({ playing: true, at: 0 });
    };
    session.record = async () => {
      const d = session.get().drawOn;
      if (!d || d.recording) return;
      const type = videoType();
      if (!type) return;
      patch({ recording: true, playing: true });
      const video = v.record().then((r) => r?.blob ?? null);
      try {
        await onSaveVideo?.(video, type.startsWith("video/mp4") ? "mp4" : "webm");
      } finally {
        await video.catch(() => null);
        patch({ recording: false, playing: false });
      }
    };
    return () => {
      ro.disconnect();
      session.replay = null;
      session.record = null;
      v.dispose();
      view.current = null;
    };
    // The player lives as long as Draw on shows; bodies and options update it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New bodies, colour or length: plan again and play from the start.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    framing.current = framingOf(
      bodies.map((b) => ({ positions: b.mesh.positions, matrix: b.matrix.elements })),
      1,
    );
    v.setBodies(bodies, { draw: drawSeconds(length), embers: EMBERS }, colour);
    v.play(0);
    const d = session.get().drawOn;
    if (d) session.set({ drawOn: { ...d, playing: true, at: 0, total: v.total } });
  }, [bodies, colour, length, session]);

  // Pause and play from the bar.
  const playing = state?.playing ?? false;
  useEffect(() => {
    const v = view.current;
    if (!v || v.isPlaying === playing) return;
    if (playing) v.play();
    else v.pause();
  }, [playing]);

  return <canvas ref={canvas} className="bc-render-canvas bc-draw-on" role="img" aria-label="Draw on: the model drawn in glowing lines" />;
}
