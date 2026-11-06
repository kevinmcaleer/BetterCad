import { useEffect, useState } from "react";
import { kernelStatus } from "@bettercad/kernel";
import { solverStatus } from "@bettercad/sketch";
import { Editor } from "./editor/Editor";
import { Gallery } from "./gallery/Gallery";

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
  if (hash.startsWith("#/gallery")) return <Gallery />;
  return <Editor />;
}
