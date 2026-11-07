import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installFetchShim } from "./api/mock.js";
import "./index.css";

// Automatically activate mock API when running with VITE_MOCK_API or without backend
if (import.meta.env.VITE_MOCK_API === "true" || !import.meta.env.VITE_API_BASE_URL) {
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
