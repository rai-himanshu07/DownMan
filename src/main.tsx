import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { migrateTheme, PAPER_BG, SIGNAL_ACCENT, SIGNAL_BG } from "./lib/theme";
import "./index.css";

migrateTheme();
const root = document.documentElement;
const light = localStorage.getItem("dm-light") === "on";
root.style.setProperty("--dm-accent", localStorage.getItem("dm-accent") || SIGNAL_ACCENT);
root.style.setProperty("--dm-bg-image", localStorage.getItem("dm-bg") || (light ? PAPER_BG : SIGNAL_BG));
root.classList.toggle("dm-light", light);
root.classList.toggle("dm-compact", localStorage.getItem("dm-density") === "compact");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
