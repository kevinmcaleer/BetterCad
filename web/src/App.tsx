import { Suspense, lazy, useEffect, useState } from "react";
import { kernelStatus } from "@bettercad/kernel";
import { solverStatus } from "@bettercad/sketch";
import { Editor } from "./editor/Editor";

/** The component gallery ships in development and in preview builds (VITE_GALLERY=1), never in the release image. */
export const GALLERY_ON = !!(import.meta.env.DEV || import.meta.env.VITE_GALLERY);
const Gallery = GALLERY_ON ? lazy(() => import("./gallery/Gallery").then((m) => ({ default: m.Gallery }))) : null;

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

// Proves the workspace packages resolve; the kernel and solver arrive in epics #4 and #5.
export const ENGINES = [kernelStatus(), solverStatus()];

/** Hash routes keep the app working from any static host: "#/" is the editor, "#/gallery" the components. */
export function App() {
  const hash = useHash();
  if (Gallery && hash.startsWith("#/gallery")) {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  return <Editor />;
}
