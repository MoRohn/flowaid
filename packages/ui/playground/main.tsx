import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import { ThemeProvider } from "@/theme";
import { App } from "./App";

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
createRoot(el).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
