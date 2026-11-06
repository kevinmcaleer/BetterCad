import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@bettercad/ui/tokens.css";
import "@bettercad/ui/components.css";
import "./app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
