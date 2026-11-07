import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BodyMesh, Call, KernelClient, KernelState, Measure, MeasureResult, Methods, TopoRef } from "@bettercad/kernel";
import { milestone } from "../perf";
import type { ModelDoc, Part } from "@bettercad/kernel/document";

/**
 * The document, built by OpenCascade in the kernel worker (#44). Until a build lands the viewport draws the JS
 * primitives; each part swaps to its kernel mesh once one has been built for exactly that shape, size and place.
 */
export interface KernelBody {
  mesh: BodyMesh;
  measure: Measure;
}

export interface KernelView {
  state: KernelState;
  /** Kernel meshes by part id, only for parts whose current shape and place match what was built. */
  bodies: Map<string, KernelBody>;
  /** Features the kernel could not build, with the reason. */
  failed: Map<string, string>;
  /** Measures picks on the model as it is now; null when the engine is off. */
  measure(refs: TopoRef[]): Promise<MeasureResult | null>;
  /** Any other kernel call (export, estimate); null when the engine is off. */
  call<M extends keyof Methods>(method: M, params: Methods[M]["params"]): Call<Methods[M]["result"]> | null;
}

export const partKey = (p: Part) => JSON.stringify([p.kind, p.size, p.position, p.rotation ?? null]);

const OFF: KernelState = { status: "failed", error: { code: "failed", message: "The geometry engine is off." } };

/** The browser client, loaded lazily so tests and the first paint do not wait for the worker. */
async function client(): Promise<KernelClient | null> {
  if (typeof Worker === "undefined" || import.meta.env.MODE === "test") return null;
  const { kernel } = await import("@bettercad/kernel/browser");
  return kernel();
}

export function useKernel(doc: ModelDoc, upTo: number, parts: Part[]): KernelView {
  const [state, setState] = useState<KernelState>({ status: "loading", fraction: 0 });
  const [built, setBuilt] = useState<{ bodies: Map<string, KernelBody & { key: string }>; failed: Map<string, string> }>(() => ({
    bodies: new Map(),
    failed: new Map(),
  }));
  const kc = useRef<KernelClient | null>(null);
  const [haveClient, setHaveClient] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    client().then(
      (c) => {
        if (gone) return;
        if (!c) return setState(OFF);
        kc.current = c;
        off = c.subscribe((s) => {
          if (s.status === "ready") milestone("kernel");
          setState(s);
        });
        setHaveClient(true);
      },
      () => !gone && setState(OFF),
    );
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  useEffect(() => {
    const c = kc.current;
    if (!c) return;
    // The keys of what this build is for, so a late reply is matched to the parts it was made from.
    const sent = new Map(parts.map((p) => [p.id, partKey(p)]));
    const call = c.call("build", { doc, upTo });
    call.then(
      (r) => {
        const bodies = new Map<string, KernelBody & { key: string }>();
        for (const b of r.bodies) bodies.set(b.id, { mesh: b.mesh, measure: b.measure, key: sent.get(b.id) ?? "" });
        setBuilt({ bodies, failed: new Map(r.failed) });
      },
      () => undefined,
    );
    return () => call.cancel();
    // parts follows doc and upTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, upTo, haveClient]);

  const bodies = useMemo(() => {
    const out = new Map<string, KernelBody>();
    for (const p of parts) {
      const b = built.bodies.get(p.id);
      if (b && b.key === partKey(p)) out.set(p.id, b);
    }
    return out;
  }, [parts, built]);

  const now = useRef({ doc, upTo });
  now.current = { doc, upTo };
  const measure = useCallback(async (refs: TopoRef[]) => {
    const c = kc.current;
    if (!c) return null;
    return c.call("measure", { doc: now.current.doc, upTo: now.current.upTo, refs });
  }, []);

  const call = useCallback(<M extends keyof Methods>(method: M, params: Methods[M]["params"]) => kc.current?.call(method, params) ?? null, []);

  return { state, bodies, failed: built.failed, measure, call };
}
