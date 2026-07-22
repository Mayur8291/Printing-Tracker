import React from "react";
import ReactDOM from "react-dom/client";
import "@radix-ui/themes/styles.css";
import App from "./App";
import PicklistPreviewPage from "./picklist/PicklistPreviewPage.jsx";
import "./styles.css";
import "./responsive-mobile-tablet.css";
import "./responsive-desktop.css";
import "./index.css";

if ("serviceWorker" in navigator) {
  const isLocalDev =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (isLocalDev) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) void reg.unregister();
    });
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    });
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.location.hash === "#/picklist-preview" ? <PicklistPreviewPage /> : <App />}
  </React.StrictMode>
);
