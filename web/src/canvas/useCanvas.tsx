import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ESC, useEscape } from "@bettercad/ui";
import type { BuiltConstruct, CanvasImage, ModelDoc } from "../state/document";
import type { View3DHandle } from "../viewport/View3D";
import { attachCanvasInput, changePicture as swapPicture, type Calib, type CanvasInputCtx } from "./input";
import { addCanvas, calibrate as calibrateTo, updateCanvas } from "./canvas";

/**
 * The Canvas tool (#248): click a plane or a flat face, choose a picture, and it sits on the plane to trace over. Drag
 * it about, calibrate it from two spots a known distance apart, and set how see-through it is. Canvases aren't steps:
 * Enter keeps the changes, Esc takes them back. It loads with its panel (CanvasTool) when the tool is picked.
 */
export interface CanvasDeps {
  store: {
    get(): ModelDoc;
    edit(fn: (d: ModelDoc) => ModelDoc, label: string, coalesceKey?: string): void;
    seal(): void;
    discard(key: string): void;
  };
  doc: ModelDoc;
  construct?: BuiltConstruct[];
  view: RefObject<View3DHandle>;
  onClose: () => void;
  say: (text: string, error?: boolean) => void;
}

const KEY = (id: string) => `canvas:${id}`;

export function useCanvas(d: CanvasDeps) {
  const deps = useRef(d);
  deps.current = d;
  const { store } = d;
  const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [calib, setCalib] = useState<Calib | null>(null);
  const canvas = d.doc.canvases?.find((c) => c.id === session?.id) ?? null;
  const live = useRef({ canvas, busy, calib });
  live.current = { canvas, busy, calib };
  useEffect(() => {
    if (session && !canvas) setSession(null);
  }, [session, canvas]);

  // Putting the tool down keeps the changes.
  useEffect(() => () => store.seal(), [store]);

  const change = useCallback(
    (c: Partial<CanvasImage>, data?: string) => {
      const id = live.current.canvas?.id;
      if (id) store.edit((x) => updateCanvas(x, id, c, data), "Change canvas", KEY(id));
    },
    [store],
  );

  const ctx = useMemo(
    (): CanvasInputCtx => ({
      canvas: () => live.current.canvas,
      construct: () => deps.current.construct,
      busy: () => live.current.busy,
      setBusy,
      calib: () => live.current.calib,
      setCalib,
      change,
      add: (c, data) => {
        store.edit((x) => addCanvas(x, c, data), "Canvas", KEY(c.id));
        setSession({ id: c.id, isNew: true });
      },
      say: (text, error) => deps.current.say(text, error),
    }),
    [change, store],
  );

  const hasCanvas = !!canvas;
  useEffect(() => {
    const eng = d.view.current?.engine();
    if (!eng) return;
    return attachCanvasInput(eng, ctx);
  }, [d.view, ctx, hasCanvas, !!calib]); // eslint-disable-line react-hooks/exhaustive-deps

  const changePicture = useCallback(() => swapPicture(ctx), [ctx]);

  /** Scales the canvas so the two spots picked are `length` mm apart. */
  const calibrate = useCallback(
    (length: number) => {
      const c = live.current.canvas;
      const k = live.current.calib;
      const to = c && k?.a && k.b && calibrateTo(c, k.a, k.b, length);
      if (!to) return;
      change({
        x: Math.round(to.x * 100) / 100,
        y: Math.round(to.y * 100) / 100,
        width: Math.round(to.width * 100) / 100,
        height: Math.round(to.height * 100) / 100,
      });
      setCalib(null);
      deps.current.say(`Calibrated: the two spots are ${length} mm apart`);
    },
    [change],
  );

  const done = useCallback(() => {
    const c = live.current.canvas;
    if (c) store.seal();
    setSession(null);
    setCalib(null);
    deps.current.onClose();
  }, [store]);

  const cancel = useCallback(() => {
    const c = live.current.canvas;
    if (c) store.discard(KEY(c.id));
    setSession(null);
    setCalib(null);
    deps.current.onClose();
  }, [store]);

  /** Opens a canvas to change it, from the browser. */
  const edit = useCallback(
    (id: string) => {
      store.seal();
      setSession({ id, isNew: false });
    },
    [store],
  );

  useEscape(!!calib, () => setCalib(null), ESC.tool + 2);
  useEscape(!!session, cancel, ESC.tool + 1);

  const help = busy
    ? "Reading the picture…"
    : calib
      ? !calib.a
        ? "Click a spot on the picture whose distance to another you know."
        : !calib.b
          ? "Click the second spot."
          : "Type how far apart the two spots really are."
      : session
        ? canvas?.locked
          ? "The canvas is locked. Unlock it to move or change it."
          : "Drag the picture to move it, or calibrate it to true size. Enter keeps it, Esc takes it back."
        : "Click a plane or a flat face, then choose a picture to trace over.";

  return { session, canvas, busy, calib, setCalib, change, changePicture, calibrate, done, cancel, edit, help };
}

export type CanvasSession = ReturnType<typeof useCanvas>;
