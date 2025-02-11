import PiwikPro from "@piwikpro/react-piwik-pro";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";

PiwikPro.initialize(
  import.meta.env.VITE_PIWIK_CONTAINER_ID,
  import.meta.env.VITE_PIWIK_CONTAINER_URL
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>
);
