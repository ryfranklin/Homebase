import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// Dev-only design preview (localhost): open /?preview for the empty state (node
// graph) or /?preview=chat for a sample conversation. Stripped from prod builds.
async function render() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("preview")) {
    const { DesignPreview } = await import("./preview");
    createRoot(root!).render(
      <StrictMode>
        <DesignPreview />
      </StrictMode>,
    );
    return;
  }
  createRoot(root!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void render();
