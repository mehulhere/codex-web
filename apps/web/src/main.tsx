import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { registerPwa } from "./pwa";
import { FrontendErrorBoundary } from "./components/FrontendErrorBoundary";
import { installClientErrorLogging } from "./lib/client-error-logger";

installClientErrorLogging();

// Apply theme before first render to avoid flash
const stored = localStorage.getItem("theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
if (stored === "dark" || (!stored && prefersDark)) {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(
  <FrontendErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </FrontendErrorBoundary>
);

void registerPwa();
