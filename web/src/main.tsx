import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@bettercad/ui/index.css";
import "./app.css";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/register";
import { listenForInstall } from "./pwa/install";

registerServiceWorker();
listenForInstall();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
