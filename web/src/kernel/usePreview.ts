import { useEffect, useState } from "react";
import type { ModelDoc } from "@bettercad/kernel/document";
import type { PreviewBody } from "../viewport/engine";
import type { KernelView } from "./useKernel";

/** The id a step being set up has in a preview build, before it is on the timeline. */
export const PREVIEW_ID = "preview";

/** How long the settings must stay still before the kernel builds the preview, in ms. */
export const PREVIEW_DELAY = 150;

/**
 * A step to preview: the document with the step in it, built up to and including the step. The bodies in
 * `show` are drawn from that build; those in `dim` go see-through (a combine's tools).
 */
export interface PreviewRequest {
  doc: ModelDoc;
  upTo: number;
  /** The step's id in `doc`, to tell when it fails. */
  step: string;
  show: string[];
  dim?: string[];
}

export interface PreviewView {
  /** What the view draws in place of the bodies the step changes; null while nothing is ready. */
  bodies: PreviewBody[] | null;
  /** Why the step does not build with these settings, if it does not. */
  error: string | null;
  /** A build is on its way. */
  busy: boolean;
}

const NONE: PreviewView = { bodies: null, error: null, busy: false };

/**
 * Builds a step's result in the kernel worker while its tool is open, so the model shows it before it is kept.
 * Changes are debounced, and a newer request cancels the build before it. The last result stays on show until the
 * next one lands, so dragging a value does not flicker.
 */
export function usePreview(call: KernelView["call"], req: PreviewRequest | null, delay = PREVIEW_DELAY): PreviewView {
  const [view, setView] = useState<PreviewView>(NONE);

  useEffect(() => {
    if (!req) {
      setView(NONE);
      return;
    }
    setView((v) => (v.busy ? v : { ...v, busy: true }));
    let job: { cancel(): void } | null = null;
    let gone = false;
    const timer = setTimeout(() => {
      const c = call("build", { doc: req.doc, upTo: req.upTo });
      if (!c) return setView(NONE);
      job = c;
      c.then(
        (r) => {
          if (gone) return;
          const failed = r.failed.find(([id]) => id === req.step);
          if (failed) return setView({ bodies: null, error: failed[1], busy: false });
          const built = new Map(r.bodies.map((b) => [b.id, b.mesh]));
          const bodies: PreviewBody[] = [];
          for (const id of req.show) {
            const mesh = built.get(id);
            if (mesh) bodies.push({ id, mesh });
          }
          for (const id of req.dim ?? []) if (!req.show.includes(id)) bodies.push({ id, dim: true });
          setView({ bodies, error: null, busy: false });
        },
        (e: { code?: string }) => {
          // A cancelled build is a newer one taking over.
          if (!gone && e?.code !== "cancelled") setView({ bodies: null, error: null, busy: false });
        },
      );
    }, delay);
    return () => {
      gone = true;
      clearTimeout(timer);
      job?.cancel();
    };
  }, [call, req, delay]);

  return view;
}
