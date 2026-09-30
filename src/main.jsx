import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerSW } from "virtual:pwa-register";

console.info(`Shelvd build: ${__BUILD_TIME__}`);

// Deliberately plain DOM/inline styles, not a React component: this has to
// keep working even from an OLD, already-loaded app bundle (the exact
// situation it exists to fix), so it can't depend on the current bundle's
// CSS or component tree being up to date. See vite.config.js's PWA comment
// for why this replaced the previous silent "autoUpdate" behavior.
const updateSW = registerSW({
  onNeedRefresh() {
    if (document.getElementById("shelvd-update-toast")) return;
    const el = document.createElement("div");
    el.id = "shelvd-update-toast";
    el.setAttribute("role", "status");
    Object.assign(el.style, {
      position: "fixed", left: "50%", bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
      transform: "translateX(-50%)", zIndex: 99999, display: "flex", alignItems: "center", gap: "12px",
      padding: "12px 16px", borderRadius: "14px", background: "#1c1917", color: "#fff",
      boxShadow: "0 8px 28px rgba(0,0,0,.35)", fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "13.5px", maxWidth: "calc(100vw - 32px)",
    });
    el.innerHTML = `<span>A new version of Shelvd is ready.</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Update now";
    Object.assign(btn.style, {
      background: "#c85a27", color: "#fff", border: "none", borderRadius: "8px",
      padding: "7px 12px", fontWeight: "700", fontSize: "13px", cursor: "pointer", flexShrink: "0",
    });
    btn.onclick = () => updateSW(true);
    el.appendChild(btn);
    document.body.appendChild(el);
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

