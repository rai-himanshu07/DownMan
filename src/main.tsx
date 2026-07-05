import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const accent = localStorage.getItem("dm-accent");
if (accent) document.documentElement.style.setProperty("--dm-accent", accent);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
