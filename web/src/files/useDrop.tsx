import { useEffect, useRef, useState, type RefObject } from "react";
import type { View3DHandle } from "../viewport/View3D";
import type { Vec3 } from "../state/document";

/**
 * Drop files on the view, or paste them (#85): a .bcad opens; STL, STEP and 3MF files are added where they land on
 * the grid (or at the origin when dropped elsewhere, such as on the parts list).
 */
export interface DropDeps {
  view: RefObject<View3DHandle>;
  openFiles: (files: File[], at?: Vec3) => Promise<void>;
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useDrop(d: DropDeps) {
  const deps = useRef(d);
  deps.current = d;
  const [zone, setZone] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    let depth = 0;
    const canvas = () => document.querySelector<HTMLElement>("[data-testid='view-canvas']");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      const r = canvas()?.getBoundingClientRect();
      if (r) setZone({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setZone(null);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setZone(null);
      const list = [...(e.dataTransfer?.files ?? [])];
      if (!list.length) return;
      // Where it lands on the grid, if it was dropped on the view.
      let at: Vec3 | undefined;
      const c = canvas();
      const r = c?.getBoundingClientRect();
      if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        const w = deps.current.view.current?.engine()?.rayPlane(e.clientX - r.left, e.clientY - r.top, [0, 0, 0], [0, 0, 1]);
        if (w) at = { x: Math.round(w[0]), y: Math.round(w[1]), z: 0 };
      }
      void deps.current.openFiles(list, at);
    };
    const paste = (e: ClipboardEvent) => {
      const list = [...(e.clipboardData?.files ?? [])];
      if (!list.length || editable(e.target)) return;
      e.preventDefault();
      void deps.current.openFiles(list);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, []);

  return zone ? (
    <div className="bc-drop" style={{ top: zone.top, left: zone.left, width: zone.width, height: zone.height }} aria-hidden="true">
      <p>
        <strong>Drop to open or add</strong>
        <span>A .bcad file opens. STL, STEP and 3MF files are added to this model where you drop them.</span>
      </p>
    </div>
  ) : null;
}
