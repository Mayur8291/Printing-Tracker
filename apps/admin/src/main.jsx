import React from "react";
import ReactDOM from "react-dom/client";
import "@radix-ui/themes/styles.css";
import App from "./application/AppRoot";
import PicklistPreviewPage from "./picklist/PicklistPreviewPage.jsx";
import "./styles.css";
import "./responsive-mobile-tablet.css";
import "./responsive-desktop.css";
import "./index.css";
import { registerPwa } from "./pwa";

registerPwa();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.location.hash === "#/picklist-preview" ? <PicklistPreviewPage /> : <App />}
  </React.StrictMode>
);
