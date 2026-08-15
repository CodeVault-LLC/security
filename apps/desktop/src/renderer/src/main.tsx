import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./styles/app.css";

/**
 * Renderer entry point.
 *
 * Mounts the application. There is no service worker, no analytics and no
 * global error reporter that phones home: an embargoed case must not produce
 * network traffic that says a researcher opened it.
 */

const container = document.getElementById("root");

if (container === null) {
  throw new Error("The renderer root element is missing.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
