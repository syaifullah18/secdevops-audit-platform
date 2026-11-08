import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installFetchShim } from "./api/mock.js";
import { IS_MOCK } from "./api/mode.js";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "material-symbols/outlined.css";
import "./index.css";
import "./tailwind.css";

// Automatically activate mock API when running with VITE_MOCK_API or without backend
if (IS_MOCK) {
  installFetchShim();
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
