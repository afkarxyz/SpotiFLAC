import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { Toaster } from "@/components/ui/sonner";
import { DebugLogger } from "@/components/DebugLogger";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster position="bottom-left" duration={1000} />
    <div className="fixed bottom-2 left-2 z-50">
      <DebugLogger />
    </div>
  </StrictMode>
);
